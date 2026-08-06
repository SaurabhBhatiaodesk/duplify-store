import db from "../../db.server";

// Ensures the currently-embedded shop has a `Shop` row. Normally this is
// created by the `afterAuth` hook in shopify.server.ts the moment OAuth
// completes, but loaders call this defensively (e.g. right after install,
// before the hook's write has necessarily committed).
export async function getOrCreateShop(shopDomain: string) {
  return db.shop.upsert({
    where: { shopDomain },
    create: { shopDomain, accessTokenEncrypted: "", scope: "" },
    update: {},
  });
}

export async function listConnectionsForOwner(ownerShopId: string) {
  return db.storeConnection.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [
        { ownerShopId },
        { sourceShopId: ownerShopId },
        { destinationShopId: ownerShopId },
      ],
    },
    include: { sourceShop: true, destinationShop: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getConnection(id: string) {
  return db.storeConnection.findUnique({
    where: { id },
    include: { sourceShop: true, destinationShop: true },
  });
}

/** Either store in a pair (or the connection owner) can open migration pages. */
export function migrationJobForShopWhere(jobId: string, shopId: string) {
  return {
    id: jobId,
    storeConnection: {
      OR: [
        { ownerShopId: shopId },
        { sourceShopId: shopId },
        { destinationShopId: shopId },
      ],
    },
  };
}
