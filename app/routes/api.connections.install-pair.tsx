import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { connectViaInstalledApp } from "../lib/services/installedPair.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });

  const form = await request.formData();
  const sourceShopDomain = String(form.get("sourceShopDomain") ?? "");

  return connectViaInstalledApp({
    ownerShopId: shop.id,
    sourceShopDomain,
  });
};
