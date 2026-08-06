import db from "../../db.server";
import { isValidShopDomain, normalizeShopDomain } from "../shopify/shop-domain";

export type InstallPairResult =
  | { ok: true }
  | { ok: false; error: string; needsInstall?: boolean; installShopDomain?: string };

/**
 * Pair two shops that already installed Duplify Store.
 * The other shop must have opened the app at least once so afterAuth saved
 * its offline token.
 */
export async function connectViaInstalledApp(params: {
  ownerShopId: string;
  /** Domain of the OTHER store (not the embedded one) */
  otherShopDomain: string;
  /** Is the embedded store the destination (import into here) or source (export from here)? */
  currentRole: "DESTINATION" | "SOURCE";
}): Promise<InstallPairResult> {
  const otherDomain = normalizeShopDomain(params.otherShopDomain);

  if (!isValidShopDomain(otherDomain)) {
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
  if (otherDomain === ownerShop.shopDomain) {
    return {
      ok: false,
      error: "Source and destination stores must be different shops",
    };
  }

  const otherShop = await db.shop.findUnique({
    where: { shopDomain: otherDomain },
  });

  if (
    !otherShop ||
    !otherShop.isActive ||
    !otherShop.accessTokenEncrypted ||
    otherShop.uninstalledAt
  ) {
    return {
      ok: false,
      needsInstall: true,
      installShopDomain: otherDomain,
      error: `Install Duplify Store on ${otherDomain} first, open the app once, then come back and connect.`,
    };
  }

  const sourceShopId =
    params.currentRole === "DESTINATION" ? otherShop.id : ownerShop.id;
  const destinationShopId =
    params.currentRole === "DESTINATION" ? ownerShop.id : otherShop.id;

  await db.storeConnection.upsert({
    where: {
      sourceShopId_destinationShopId: {
        sourceShopId,
        destinationShopId,
      },
    },
    create: {
      ownerShopId: ownerShop.id,
      sourceShopId,
      destinationShopId,
      status: "READY",
    },
    update: {
      status: "READY",
      ownerShopId: ownerShop.id,
    },
  });

  return { ok: true };
}
