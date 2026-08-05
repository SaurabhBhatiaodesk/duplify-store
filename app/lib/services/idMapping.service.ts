import db from "../../db.server";

// The permanent source-id -> destination-id lookup table. Every processor
// consults this before creating anything, and writes to it after a successful
// create — that's what makes re-running a migration (or retrying failed
// items) idempotent instead of producing duplicates.

export async function getMapping(
  storeConnectionId: string,
  resourceType: string,
  sourceId: string,
): Promise<{ destinationId: string; destinationHandle: string | null } | null> {
  const mapping = await db.idMapping.findUnique({
    where: {
      storeConnectionId_resourceType_sourceId: {
        storeConnectionId,
        resourceType,
        sourceId,
      },
    },
  });
  if (!mapping) return null;
  return {
    destinationId: mapping.destinationId,
    destinationHandle: mapping.destinationHandle,
  };
}

export async function saveMapping(params: {
  storeConnectionId: string;
  resourceType: string;
  sourceId: string;
  destinationId: string;
  sourceHandle?: string | null;
  destinationHandle?: string | null;
}): Promise<void> {
  await db.idMapping.upsert({
    where: {
      storeConnectionId_resourceType_sourceId: {
        storeConnectionId: params.storeConnectionId,
        resourceType: params.resourceType,
        sourceId: params.sourceId,
      },
    },
    create: {
      storeConnectionId: params.storeConnectionId,
      resourceType: params.resourceType,
      sourceId: params.sourceId,
      destinationId: params.destinationId,
      sourceHandle: params.sourceHandle ?? null,
      destinationHandle: params.destinationHandle ?? null,
    },
    update: {
      destinationId: params.destinationId,
      destinationHandle: params.destinationHandle ?? null,
    },
  });
}

// Shopify GIDs are globally unique, so for reference-type fields (metafields/
// metaobject fields pointing at a product, page, another metaobject, etc.)
// we can resolve the destination id without knowing which resourceType it
// was stored under.
export async function getMappingBySourceIdAnyType(
  storeConnectionId: string,
  sourceId: string,
): Promise<string | null> {
  const mapping = await db.idMapping.findFirst({
    where: { storeConnectionId, sourceId },
    select: { destinationId: true },
  });
  return mapping?.destinationId ?? null;
}

export async function getMappingsByType(
  storeConnectionId: string,
  resourceType: string,
): Promise<Map<string, string>> {
  const rows = await db.idMapping.findMany({
    where: { storeConnectionId, resourceType },
    select: { sourceId: true, destinationId: true },
  });
  return new Map(rows.map((r) => [r.sourceId, r.destinationId]));
}
