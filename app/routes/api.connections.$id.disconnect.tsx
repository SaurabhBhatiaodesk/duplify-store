import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } });

  const connection = await db.storeConnection.findFirstOrThrow({
    where: { id: params.id, ownerShopId: shop.id },
  });

  // Archiving (not deleting) preserves migration history/ID mappings for
  // this pair — matches the audit-retention approach used elsewhere (see
  // webhooks.app.uninstalled.tsx).
  await db.storeConnection.update({
    where: { id: connection.id },
    data: { status: "ARCHIVED" },
  });

  return redirect("/app/connect");
};
