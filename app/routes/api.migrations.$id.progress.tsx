import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Lightweight JSON polling endpoint mirroring the fields shown on the
// Migration Progress page — useful for polling without a full page/loader
// revalidation (e.g. a future embedded status widget).
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } });

  const job = await db.migrationJob.findFirstOrThrow({
    where: { id: params.id, storeConnection: { ownerShopId: shop.id } },
  });

  return Response.json({
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    totalRecords: job.totalRecords,
    completedRecords: job.completedRecords,
    failedRecords: job.failedRecords,
    skippedRecords: job.skippedRecords,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
};
