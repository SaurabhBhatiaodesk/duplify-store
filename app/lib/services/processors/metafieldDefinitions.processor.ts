import db from "../../../db.server";
import { createAdminClient } from "../../shopify/admin-client";
import { METAFIELD_DEFINITIONS_QUERY, METAFIELD_DEFINITION_OWNER_TYPES } from "../../shopify/queries/metafields";
import { METAFIELD_DEFINITION_CREATE_MUTATION, type MetafieldDefinitionInput } from "../../shopify/mutations/metafields";
import { getMapping, saveMapping } from "../idMapping.service";
import { isMigrationCancelled, logEvent } from "../migrationJob.service";
import type { MetafieldDefinitionBulkPayload } from "../types";
import type { MigrationJobWithConnection } from "../orchestrator.service";
import { shouldSkipDefinitionCreateError, skippedDefinitionMessage } from "./shopify-error-classifier";

function definitionSourceId(payload: MetafieldDefinitionBulkPayload): string {
  return `${payload.ownerType}:${payload.namespace}:${payload.key}`;
}

interface DefinitionsResponse {
  metafieldDefinitions: {
    edges: Array<{ node: { namespace: string; key: string; name: string; description: string | null; type: { name: string } } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function ensureMetafieldDefinitionItems(job: MigrationJobWithConnection): Promise<void> {
  const existing = await db.migrationItem.count({ where: { migrationJobId: job.id, resourceType: "metafield_definition" } });
  if (existing > 0) return;

  await logEvent(job.id, "INFO", "Exporting metafield definitions from source store");
  const sourceAdmin = createAdminClient(job.storeConnection.sourceShop);

  const rows: Array<{ migrationJobId: string; resourceType: string; stage: string; sourceId: string; status: "PENDING"; payload: object }> = [];

  for (const ownerType of METAFIELD_DEFINITION_OWNER_TYPES) {
    let after: string | null = null;
    do {
      const result: DefinitionsResponse = await sourceAdmin.graphql<DefinitionsResponse>(
        METAFIELD_DEFINITIONS_QUERY,
        { ownerType, after },
        15,
      );
      for (const edge of result.metafieldDefinitions.edges) {
        const payload: MetafieldDefinitionBulkPayload = {
          ownerType,
          namespace: edge.node.namespace,
          key: edge.node.key,
          name: edge.node.name,
          description: edge.node.description,
          type: edge.node.type.name,
        };
        rows.push({
          migrationJobId: job.id,
          resourceType: "metafield_definition",
          stage: "metafield_definitions",
          sourceId: definitionSourceId(payload),
          status: "PENDING",
          payload: payload as unknown as object,
        });
      }
      after = result.metafieldDefinitions.pageInfo.hasNextPage ? result.metafieldDefinitions.pageInfo.endCursor : null;
    } while (after);
  }

  if (rows.length > 0) await db.migrationItem.createMany({ data: rows });
  await logEvent(job.id, "INFO", `Found ${rows.length} metafield definitions to migrate`);
}

interface DefinitionCreateResponse {
  metafieldDefinitionCreate: {
    createdDefinition: { id: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

export async function runMetafieldDefinitionsStage(job: MigrationJobWithConnection): Promise<void> {
  await ensureMetafieldDefinitionItems(job);

  const destAdmin = createAdminClient(job.storeConnection.destinationShop);
  const pendingItems = await db.migrationItem.findMany({
    where: { migrationJobId: job.id, resourceType: "metafield_definition", status: { in: ["PENDING", "RETRYING"] } },
  });

  for (const item of pendingItems) {
    if (await isMigrationCancelled(job.id)) return;
    const def = item.payload as unknown as MetafieldDefinitionBulkPayload;
    await db.migrationItem.update({ where: { id: item.id }, data: { status: "PROCESSING", attempt: item.attempt + 1 } });

    const alreadyMapped = await getMapping(job.storeConnectionId, "metafield_definition", item.sourceId);
    if (alreadyMapped) {
      await db.migrationItem.update({ where: { id: item.id }, data: { status: "COMPLETED", destinationId: alreadyMapped.destinationId, errorMessage: null } });
      continue;
    }

    const input: MetafieldDefinitionInput = {
      name: def.name,
      namespace: def.namespace,
      key: def.key,
      description: def.description ?? undefined,
      type: def.type,
      ownerType: def.ownerType,
    };

    try {
      const result = await destAdmin.graphql<DefinitionCreateResponse>(METAFIELD_DEFINITION_CREATE_MUTATION, { definition: input }, 10);
      const userErrors = result.metafieldDefinitionCreate.userErrors;
      const skippableError = userErrors.find((e) => shouldSkipDefinitionCreateError(e.message));

      if (skippableError) {
        await db.migrationItem.update({ where: { id: item.id }, data: { status: "SKIPPED", errorMessage: skippedDefinitionMessage(skippableError.message) } });
        continue;
      }

      if (userErrors.length > 0 || !result.metafieldDefinitionCreate.createdDefinition) {
        const message = userErrors.map((e) => e.message).join("; ") || "Unknown metafieldDefinitionCreate error";
        await db.migrationItem.update({ where: { id: item.id }, data: { status: "FAILED", errorMessage: message } });
        await logEvent(job.id, "ERROR", message, { itemId: item.id });
        continue;
      }

      const destinationId = result.metafieldDefinitionCreate.createdDefinition.id;
      await saveMapping({ storeConnectionId: job.storeConnectionId, resourceType: "metafield_definition", sourceId: item.sourceId, destinationId });
      await db.migrationItem.update({ where: { id: item.id }, data: { status: "COMPLETED", destinationId, errorMessage: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.migrationItem.update({ where: { id: item.id }, data: { status: "FAILED", errorMessage: message } });
      await logEvent(job.id, "ERROR", message, { itemId: item.id });
    }
  }
}
