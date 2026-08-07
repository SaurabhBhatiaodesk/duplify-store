import db from "../../../db.server";
import { createAdminClient } from "../../shopify/admin-client";
import { collectGroupedBulkResults, runBulkQuery } from "../../shopify/bulk-operations";
import { BULK_CUSTOMERS_QUERY, CUSTOMER_BY_EMAIL_QUERY } from "../../shopify/queries/customers";
import { CUSTOMER_CREATE_MUTATION, type CustomerCreateInput } from "../../shopify/mutations/customers";
import { getLiveMapping, saveMapping } from "../idMapping.service";
import { isMigrationCancelled, logEvent } from "../migrationJob.service";
import type { ConflictStrategy, CustomerBulkPayload } from "../types";
import type { MigrationJobWithConnection } from "../orchestrator.service";

export async function ensureCustomerItems(job: MigrationJobWithConnection): Promise<void> {
  const existing = await db.migrationItem.count({
    where: { migrationJobId: job.id, resourceType: "customer" },
  });
  if (existing > 0) return;

  await logEvent(job.id, "INFO", "Exporting customers from source store");

  const sourceAdmin = createAdminClient(job.storeConnection.sourceShop);
  const op = await runBulkQuery(sourceAdmin, BULK_CUSTOMERS_QUERY);
  if (!op.url) {
    await logEvent(job.id, "INFO", "Source store has no customers to migrate");
    return;
  }

  const grouped = await collectGroupedBulkResults(op.url);

  const rows = grouped.map((record) => ({
    migrationJobId: job.id,
    resourceType: "customer",
    stage: "customers",
    sourceId: (record.parent as unknown as CustomerBulkPayload).id,
    status: "PENDING" as const,
    payload: record.parent as unknown as object,
  }));

  if (rows.length > 0) {
    await db.migrationItem.createMany({ data: rows });
  }
  await logEvent(job.id, "INFO", `Found ${rows.length} customers to migrate`);
}

interface CustomerCreateResponse {
  customerCreate: {
    customer: { id: string; email: string | null } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

interface CustomerByEmailResponse {
  customers: { edges: Array<{ node: { id: string; email: string | null } }> };
}

export async function runCustomersStage(job: MigrationJobWithConnection): Promise<void> {
  await ensureCustomerItems(job);

  const conflictStrategy: ConflictStrategy =
    (job.conflictStrategy as Record<string, ConflictStrategy>).customers ?? "SKIP";

  const destAdmin = createAdminClient(job.storeConnection.destinationShop);

  const pendingItems = await db.migrationItem.findMany({
    where: {
      migrationJobId: job.id,
      resourceType: "customer",
      status: { in: ["PENDING", "RETRYING"] },
    },
  });

  for (const item of pendingItems) {
    if (await isMigrationCancelled(job.id)) return;
    await processCustomerItem(job, item, destAdmin, conflictStrategy);
  }
}

async function processCustomerItem(
  job: MigrationJobWithConnection,
  item: { id: string; sourceId: string; attempt: number; payload: unknown },
  destAdmin: ReturnType<typeof createAdminClient>,
  conflictStrategy: ConflictStrategy,
): Promise<void> {
  const customer = item.payload as unknown as CustomerBulkPayload;
  const storeConnectionId = job.storeConnectionId;

  await db.migrationItem.update({
    where: { id: item.id },
    data: { status: "PROCESSING", attempt: item.attempt + 1 },
  });

  const alreadyMapped = await getLiveMapping(
    destAdmin,
    storeConnectionId,
    "customer",
    item.sourceId,
  );
  if (alreadyMapped) {
    await db.migrationItem.update({
      where: { id: item.id },
      data: { status: "COMPLETED", destinationId: alreadyMapped.destinationId, errorMessage: null },
    });
    return;
  }

  if (!customer.email) {
    await db.migrationItem.update({
      where: { id: item.id },
      data: { status: "SKIPPED", errorMessage: "Customer has no email address (dedup key required)" },
    });
    return;
  }

  let existingDestinationId: string | null = null;
  try {
    const existing = await destAdmin.graphql<CustomerByEmailResponse>(
      CUSTOMER_BY_EMAIL_QUERY,
      { query: `email:'${customer.email.replace(/'/g, "")}'` },
      5,
    );
    existingDestinationId = existing.customers.edges[0]?.node.id ?? null;
  } catch (error) {
    await fail(job.id, item.id, `Conflict check failed: ${errMsg(error)}`);
    return;
  }

  if (existingDestinationId && conflictStrategy === "SKIP") {
    await saveMapping({
      storeConnectionId,
      resourceType: "customer",
      sourceId: item.sourceId,
      destinationId: existingDestinationId,
    });
    await db.migrationItem.update({
      where: { id: item.id },
      data: {
        status: "SKIPPED",
        destinationId: existingDestinationId,
        errorMessage: "Customer with this email already exists on the destination store",
      },
    });
    return;
  }

  if (existingDestinationId && conflictStrategy !== "CREATE_NEW") {
    // Customers can't be "overwritten" via customerCreate — map to the
    // existing record so downstream stages (e.g. Orders) can still reference it.
    await saveMapping({
      storeConnectionId,
      resourceType: "customer",
      sourceId: item.sourceId,
      destinationId: existingDestinationId,
    });
    await db.migrationItem.update({
      where: { id: item.id },
      data: { status: "COMPLETED", destinationId: existingDestinationId, errorMessage: null },
    });
    return;
  }

  const input: CustomerCreateInput = {
    firstName: customer.firstName ?? undefined,
    lastName: customer.lastName ?? undefined,
    email: customer.email,
    phone: customer.phone ?? undefined,
    note: customer.note ?? undefined,
    tags: customer.tags,
    taxExempt: customer.taxExempt,
    addresses: (customer.addresses ?? []).map((a) => ({
      address1: a.address1 ?? undefined,
      address2: a.address2 ?? undefined,
      city: a.city ?? undefined,
      provinceCode: a.provinceCode ?? undefined,
      countryCode: a.countryCodeV2 ?? undefined,
      zip: a.zip ?? undefined,
      phone: a.phone ?? undefined,
      firstName: a.firstName ?? undefined,
      lastName: a.lastName ?? undefined,
      company: a.company ?? undefined,
    })),
  };

  try {
    const result = await destAdmin.graphql<CustomerCreateResponse>(
      CUSTOMER_CREATE_MUTATION,
      { input },
      20,
    );

    if (
      !result.customerCreate ||
      (result.customerCreate.userErrors?.length ?? 0) > 0 ||
      !result.customerCreate.customer
    ) {
      const message =
        (result.customerCreate?.userErrors ?? [])
          .map((e) => e.message)
          .filter(Boolean)
          .join("; ") || "Unknown customerCreate error";
      await fail(job.id, item.id, message);
      return;
    }

    const destinationId = result.customerCreate.customer.id;
    await saveMapping({ storeConnectionId, resourceType: "customer", sourceId: item.sourceId, destinationId });
    await db.migrationItem.update({
      where: { id: item.id },
      data: { status: "COMPLETED", destinationId, errorMessage: null },
    });
    await logEvent(job.id, "INFO", `Migrated customer "${customer.email}"`, { sourceId: item.sourceId });
  } catch (error) {
    await fail(job.id, item.id, errMsg(error));
  }
}

async function fail(migrationJobId: string, itemId: string, message: string): Promise<void> {
  await db.migrationItem.update({ where: { id: itemId }, data: { status: "FAILED", errorMessage: message } });
  await logEvent(migrationJobId, "ERROR", message, { itemId });
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
