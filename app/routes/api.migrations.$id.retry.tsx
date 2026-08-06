import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markItemsForRetry, resumeMigration } from "../lib/services/orchestrator.service";
import { migrationJobForShopWhere } from "../lib/services/storeConnection.service";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  return redirect(`/app/migrations/${params.id}/progress`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } });

  const job = await db.migrationJob.findFirst({
    where: migrationJobForShopWhere(params.id!, shop.id),
  });
  if (!job) {
    return redirect("/app/migrations");
  }

  const retriedCount = await markItemsForRetry(job.id);
  if (retriedCount > 0) {
    await db.migrationJob.update({ where: { id: job.id }, data: { status: "QUEUED" } });
    try {
      const { migrationQueue } = await import("../lib/queue/queues");
      await migrationQueue.add("resume", { migrationJobId: job.id, mode: "resume" });
    } catch (error) {
      console.warn("Migration queue unavailable; resuming migration inline", error);
      await resumeMigration(job.id);
    }
  }

  return redirect(`/app/migrations/${job.id}/progress`);
};
