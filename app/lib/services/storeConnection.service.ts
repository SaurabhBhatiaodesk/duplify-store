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
    where: { ownerShopId, status: { not: "ARCHIVED" } },
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
