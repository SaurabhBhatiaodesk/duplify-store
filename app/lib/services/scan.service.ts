import db from "../../db.server";
import { createAdminClient, type AdminClient } from "../shopify/admin-client";
import {
  missingReadScopes,
  missingRequestedScopes,
  missingScopes,
} from "../shopify/scopes";
import {
  getMigrationJob,
  logEvent,
  setJobStatus,
} from "./migrationJob.service";

// The scan is a fast, informational preview — it is NOT the authoritative
// dedup check. The actual migration processors always re-check
// IdMapping + a live handle/SKU lookup at the moment they create each record,
// so it's safe (and much cheaper) for the scan to work off a bounded sample
// instead of exporting the entire catalog twice before the merchant has even
// confirmed they want to migrate.
const CONFLICT_SAMPLE_SIZE = 250;
const HANDLES_PER_SEARCH_QUERY = 20;

interface ResourceScanResult {
  total: number;
  sampledConflicts: number;
  sampleSize: number;
  sampleTruncated: boolean;
  unsupported: string[];
}

export interface ScanSummary {
  generatedAt: string;
  resources: Record<string, ResourceScanResult>;
  requiredPermissions: Array<{
    resourceType: string;
    missing: string[];
    shopRole?: "source" | "destination";
    shopDomain?: string;
  }>;
}

// resourceType (as used in RESOURCE_TYPE_SCOPES) -> root connection field to
// preview. Resources without a natural handle/email based conflict check
// (files, menus, definitions, theme, orders, discounts, metaobjects) still
// get an approximate count so the scan summary always lists everything the
// merchant selected — see scanApprox below.
const HANDLE_KEYED = [
  { resourceType: "product", field: "products" },
  { resourceType: "collection", field: "collections" },
] as const;

const APPROX_COUNT_FIELDS: Record<
  string,
  { field: string; countField?: string }
> = {
  customer: { field: "customers", countField: "customersCount" },
  page: { field: "pages" },
  blog: { field: "blogs" },
  file: { field: "files" },
  order: { field: "orders", countField: "ordersCount" },
};

export async function runScan(migrationJobId: string): Promise<void> {
  const job = await getMigrationJob(migrationJobId);
  if (!job) throw new Error(`MigrationJob ${migrationJobId} not found`);

  await setJobStatus(migrationJobId, "SCANNING");
  await logEvent(migrationJobId, "INFO", "Pre-migration scan started");

  const sourceAdmin = createAdminClient(job.storeConnection.sourceShop);
  const destAdmin = createAdminClient(job.storeConnection.destinationShop);
  const resources = job.selectedResources as string[];
  const sourceShop = job.storeConnection.sourceShop;
  const destinationShop = job.storeConnection.destinationShop;
  const sourceScope = sourceShop.scope;
  const destScope = job.storeConnection.destinationShop.scope;

  const summary: ScanSummary = {
    generatedAt: new Date().toISOString(),
    resources: {},
    requiredPermissions: [],
  };

  try {
    const missingAppPermissions = [
      {
        resourceType: "app permissions",
        missing: missingRequestedScopes(sourceScope),
        shopRole: "source" as const,
        shopDomain: sourceShop.shopDomain,
      },
      {
        resourceType: "app permissions",
        missing: missingRequestedScopes(destScope),
        shopRole: "destination" as const,
        shopDomain: destinationShop.shopDomain,
      },
    ].filter((p) => p.missing.length > 0);

    const selectedResourceTypes = resourceTypesForSelections(resources);
    const missingSourcePermissions =
      missingAppPermissions.length > 0
        ? []
        : selectedResourceTypes
            .map((resourceType) => ({
              resourceType,
              missing: missingReadScopes(resourceType, sourceScope),
              shopRole: "source" as const,
              shopDomain: sourceShop.shopDomain,
            }))
            .filter((p) => p.missing.length > 0);

    const missingDestinationPermissions =
      missingAppPermissions.length > 0
        ? []
        : selectedResourceTypes
            .map((resourceType) => ({
              resourceType,
              missing: missingScopes(resourceType, destScope),
              shopRole: "destination" as const,
              shopDomain: destinationShop.shopDomain,
            }))
            .filter((p) => p.missing.length > 0);

    summary.requiredPermissions.push(
      ...missingAppPermissions,
      ...missingSourcePermissions,
      ...missingDestinationPermissions,
    );

    if (summary.requiredPermissions.length > 0) {
      for (const key of resources) {
        summary.resources[key] = {
          total: 0,
          sampledConflicts: 0,
          sampleSize: 0,
          sampleTruncated: false,
          unsupported: ["Store pair is missing required Admin API permissions"],
        };
      }

      await db.migrationJob.update({
        where: { id: migrationJobId },
        data: {
          status: "SCANNED",
          scanSummary: summary as unknown as object,
          totalRecords: 0,
        },
      });

      await logEvent(
        migrationJobId,
        "WARN",
        "Pre-migration scan skipped because store permissions are missing",
        {
          missingPermissions: summary.requiredPermissions,
        },
      );
      return;
    }

    for (const { resourceType, field } of HANDLE_KEYED) {
      const selectionKey = field; // "products" / "collections" are also the selectedResources keys
      if (!resources.includes(selectionKey)) continue;
      summary.resources[field] = await scanByHandle(
        sourceAdmin,
        destAdmin,
        field,
        resourceType,
        missingReadScopes(resourceType, destScope).length === 0,
      );
    }

    for (const [resourceType, { field, countField }] of Object.entries(
      APPROX_COUNT_FIELDS,
    )) {
      if (!resources.includes(field)) continue;
      summary.resources[field] = await scanApprox(
        sourceAdmin,
        field,
        countField,
      );
    }

    // Resources previewed as "included" only (exact/approximate counting
    // isn't meaningful or the API doesn't expose a simple count for them) —
    // still listed so the scan reflects everything selected, and permissions
    // are still checked.
    const includedOnly: Array<{ key: string; resourceType: string }> = [
      { key: "files", resourceType: "file" },
      { key: "menus", resourceType: "menu" },
      { key: "discounts", resourceType: "discount" },
      { key: "theme", resourceType: "theme" },
      { key: "metafield_definitions", resourceType: "metafield_definition" },
      { key: "metaobject_definitions", resourceType: "metaobject_definition" },
      { key: "metaobjects", resourceType: "metaobject" },
    ];
    for (const { key, resourceType } of includedOnly) {
      if (!resources.includes(key)) continue;
      if (summary.resources[key]) continue; // already handled above (e.g. "files")
      summary.resources[key] = {
        total: 0,
        sampledConflicts: 0,
        sampleSize: 0,
        sampleTruncated: false,
        unsupported: ["Exact count shown after migration starts"],
      };
    }

    const totalRecords = Object.values(summary.resources).reduce(
      (sum, r) => sum + r.total,
      0,
    );

    await db.migrationJob.update({
      where: { id: migrationJobId },
      data: {
        status: "SCANNED",
        scanSummary: summary as unknown as object,
        totalRecords,
      },
    });

    await logEvent(migrationJobId, "INFO", "Pre-migration scan completed", {
      totalRecords,
    });
  } catch (error) {
    await logEvent(migrationJobId, "ERROR", "Pre-migration scan failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await setJobStatus(migrationJobId, "FAILED");
    throw error;
  }
}

export const SELECTION_RESOURCE_TYPES: Record<string, string[]> = {
  products: ["product", "variant"],
  images: ["image"],
  inventory: ["inventory"],
  collections: ["collection"],
  customers: ["customer"],
  pages: ["page"],
  blogs: ["blog", "article"],
  files: ["file"],
  metafield_definitions: ["metafield_definition"],
  metaobject_definitions: ["metaobject_definition"],
  metaobjects: ["metaobject"],
  menus: ["menu"],
  discounts: ["discount"],
  orders: ["order"],
  theme: ["theme"],
};

export function resourceTypesForSelections(resources: string[]) {
  return Array.from(
    new Set(
      resources.flatMap((resource) => SELECTION_RESOURCE_TYPES[resource] ?? []),
    ),
  );
}

async function scanApprox(
  sourceAdmin: AdminClient,
  field: string,
  countField?: string,
): Promise<ResourceScanResult> {
  if (countField) {
    try {
      const countResult = await sourceAdmin.graphql<
        Record<string, { count: number }>
      >(
        `#graphql
          query duplifyApproxCount {
            ${countField} { count }
          }
        `,
        undefined,
        5,
      );
      const total = countResult[countField]?.count ?? 0;
      return {
        total,
        sampledConflicts: 0,
        sampleSize: 0,
        sampleTruncated: false,
        unsupported: [],
      };
    } catch {
      // fall through to page-based estimate below
    }
  }

  const result = await sourceAdmin.graphql<{
    [key: string]: { edges: unknown[] };
  }>(
    `#graphql
      query duplifyApproxSample {
        ${field}(first: ${CONFLICT_SAMPLE_SIZE}) {
          edges { node { id } }
        }
      }
    `,
    undefined,
    Math.ceil(CONFLICT_SAMPLE_SIZE / 10),
  );
  const count = result[field]?.edges.length ?? 0;
  return {
    total: count,
    sampledConflicts: 0,
    sampleSize: count,
    sampleTruncated: count >= CONFLICT_SAMPLE_SIZE,
    unsupported: [],
  };
}

async function scanByHandle(
  sourceAdmin: AdminClient,
  destAdmin: AdminClient,
  connectionField: "products" | "collections",
  resourceType: "product" | "collection",
  canCheckDestinationConflicts: boolean,
): Promise<ResourceScanResult> {
  const countField =
    connectionField === "products" ? "productsCount" : "collectionsCount";

  const countResult = await sourceAdmin.graphql<
    Record<string, { count: number }>
  >(
    `#graphql
      query duplifyCount {
        ${countField} { count }
      }
    `,
    undefined,
    5,
  );
  const total = countResult[countField]?.count ?? 0;

  const sampleHandles = await fetchHandleSample(sourceAdmin, connectionField);
  if (!canCheckDestinationConflicts) {
    return {
      total,
      sampledConflicts: 0,
      sampleSize: sampleHandles.length,
      sampleTruncated: total > sampleHandles.length,
      unsupported: [
        `Destination store is missing read permissions for ${resourceType} conflict checks`,
      ],
    };
  }

  const existingHandles = await findExistingHandles(
    destAdmin,
    connectionField,
    sampleHandles,
  );

  return {
    total,
    sampledConflicts: existingHandles.size,
    sampleSize: sampleHandles.length,
    sampleTruncated: total > sampleHandles.length,
    unsupported: [],
  };
}

async function fetchHandleSample(
  admin: AdminClient,
  connectionField: "products" | "collections",
): Promise<string[]> {
  const result = await admin.graphql<{
    [key: string]: { edges: Array<{ node: { handle: string } }> };
  }>(
    `#graphql
      query duplifySample {
        ${connectionField}(first: ${CONFLICT_SAMPLE_SIZE}) {
          edges { node { handle } }
        }
      }
    `,
    undefined,
    Math.ceil(CONFLICT_SAMPLE_SIZE / 10),
  );

  return result[connectionField].edges.map((e) => e.node.handle);
}

async function findExistingHandles(
  admin: AdminClient,
  connectionField: "products" | "collections",
  handles: string[],
): Promise<Set<string>> {
  const found = new Set<string>();

  for (let i = 0; i < handles.length; i += HANDLES_PER_SEARCH_QUERY) {
    const chunk = handles.slice(i, i + HANDLES_PER_SEARCH_QUERY);
    if (chunk.length === 0) continue;

    const query = chunk
      .map((h) => `handle:'${h.replace(/'/g, "")}'`)
      .join(" OR ");

    const result = await admin.graphql<{
      [key: string]: { edges: Array<{ node: { handle: string } }> };
    }>(
      `#graphql
        query duplifyHandleCheck($query: String!) {
          ${connectionField}(first: ${HANDLES_PER_SEARCH_QUERY}, query: $query) {
            edges { node { handle } }
          }
        }
      `,
      { query },
      5,
    );

    for (const edge of result[connectionField].edges) {
      found.add(edge.node.handle);
    }
  }

  return found;
}
