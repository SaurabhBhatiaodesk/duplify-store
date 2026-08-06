import db from "../../db.server";
import { encryptToken } from "../crypto/token-cipher";
import { createAdminClient } from "../shopify/admin-client";
import { shopCanMigrate } from "../shopify/scopes";

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

/**
 * Mirror the embedded session into our Shop table on every app open so
 * permission checks (Overview banner, scan) see the real granted scopes —
 * not a stale empty row left behind by getOrCreateShop / pairing.
 */
export async function syncEmbeddedShopFromSession(session: {
  shop: string;
  accessToken?: string;
  scope?: string;
}) {
  const token = session.accessToken?.trim() ?? "";
  const scope = session.scope?.trim() ?? "";

  return db.shop.upsert({
    where: { shopDomain: session.shop },
    create: {
      shopDomain: session.shop,
      accessTokenEncrypted: token ? encryptToken(token) : "",
      scope,
      isActive: true,
      uninstalledAt: null,
    },
    update: {
      ...(token ? { accessTokenEncrypted: encryptToken(token) } : {}),
      ...(scope ? { scope } : {}),
      isActive: true,
      uninstalledAt: null,
    },
  });
}

/**
 * If a paired shop has a token but an empty/stale scope string (common after
 * pairing), refresh scopes from Shopify so Overview stops saying
 * "needs Duplify installed".
 */
export async function refreshShopScopesIfStale(shop: {
  id: string;
  shopDomain: string;
  scope: string;
  accessTokenEncrypted: string;
  isActive: boolean;
  uninstalledAt: Date | null;
}): Promise<string> {
  if (!shop.isActive || shop.uninstalledAt || !shop.accessTokenEncrypted) {
    return shop.scope;
  }
  if (shopCanMigrate(shop.scope)) return shop.scope;

  try {
    const admin = createAdminClient(shop);
    const result = await admin.graphql<{
      currentAppInstallation: {
        accessScopes: Array<{ handle: string }>;
      };
    }>(
      `#graphql
        query duplifyCurrentAccessScopes {
          currentAppInstallation {
            accessScopes { handle }
          }
        }
      `,
      undefined,
      2,
    );
    const liveScope = result.currentAppInstallation.accessScopes
      .map((scope) => scope.handle)
      .filter(Boolean)
      .join(",");
    if (!liveScope) return shop.scope;

    await db.shop.update({
      where: { id: shop.id },
      data: { scope: liveScope, isActive: true, uninstalledAt: null },
    });
    return liveScope;
  } catch {
    return shop.scope;
  }
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
