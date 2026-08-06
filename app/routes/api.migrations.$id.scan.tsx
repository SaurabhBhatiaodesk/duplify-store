import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runScan } from "../lib/services/scan.service";
import { migrationJobForShopWhere } from "../lib/services/storeConnection.service";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  return redirect(`/app/migrations/${params.id}/scan`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });

  const job = await db.migrationJob.findFirst({
    where: migrationJobForShopWhere(params.id!, shop.id),
  });
  if (!job) {
    return redirect("/app/migrations");
  }

  if (!["DRAFT", "SCANNED", "FAILED"].includes(job.status)) {
    return redirect(`/app/migrations/${job.id}/scan`);
  }

  await db.migrationJob.update({
    where: { id: job.id },
    data: { status: "SCANNING", currentStage: null },
  });

  try {
    const { scanQueue } = await import("../lib/queue/queues");
    await scanQueue.add("scan", { migrationJobId: job.id });
  } catch (error) {
    console.warn("Scan queue unavailable; running scan inline", error);
    await runScan(job.id);
  }

  return redirect(`/app/migrations/${job.id}/scan`);
};
