import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } });

  const connection = await db.storeConnection.findFirst({
    where: {
      id: params.id,
      OR: [
        { ownerShopId: shop.id },
        { sourceShopId: shop.id },
        { destinationShopId: shop.id },
      ],
    },
  });
  if (!connection) {
    return redirect("/app/connect");
  }

  // Soft-disconnect: archive the pair so it disappears from Connected stores.
  // Migrated Shopify data is left untouched on both stores.
  await db.storeConnection.update({
    where: { id: connection.id },
    data: { status: "ARCHIVED" },
  });

  return redirect("/app/connect");
};
