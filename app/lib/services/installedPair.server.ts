import db from "../../db.server";
import { isValidShopDomain } from "../shopify/shop-domain";

export type InstallPairResult =
  | { ok: true }
  | { ok: false; error: string; needsInstall?: boolean };

/**
 * Pair two shops that already installed Duplify Store.
 * Each install stores an offline token via afterAuth — no extra OAuth or
 * custom-app token is required.
 */
export async function connectViaInstalledApp(params: {
  ownerShopId: string;
  /** Domain of the store to copy FROM */
  sourceShopDomain: string;
}): Promise<InstallPairResult> {
  const sourceDomain = params.sourceShopDomain.trim().toLowerCase();

  if (!isValidShopDomain(sourceDomain)) {
    return {
      ok: false,
      error: "Enter a valid shop domain, e.g. your-store.myshopify.com",
    };
  }

  const ownerShop = await db.shop.findUnique({
    where: { id: params.ownerShopId },
  });
  if (!ownerShop) {
    return { ok: false, error: "Current shop is not fully registered yet" };
  }
  if (sourceDomain === ownerShop.shopDomain) {
    return {
      ok: false,
      error: "Source and destination stores must be different shops",
    };
  }

  const sourceShop = await db.shop.findUnique({
    where: { shopDomain: sourceDomain },
  });

  if (
    !sourceShop ||
    !sourceShop.isActive ||
    !sourceShop.accessTokenEncrypted ||
    sourceShop.uninstalledAt
  ) {
    return {
      ok: false,
      needsInstall: true,
      error: `Install Duplify Store on ${sourceDomain} first (open the app once while logged into that store). Then come back here and connect.`,
    };
  }

  // Destination is the shop currently using the embedded app.
  await db.storeConnection.upsert({
    where: {
      sourceShopId_destinationShopId: {
        sourceShopId: sourceShop.id,
        destinationShopId: ownerShop.id,
      },
    },
    create: {
      ownerShopId: ownerShop.id,
      sourceShopId: sourceShop.id,
      destinationShopId: ownerShop.id,
      status: "READY",
    },
    update: {
      status: "READY",
      ownerShopId: ownerShop.id,
    },
  });

  return { ok: true };
}
