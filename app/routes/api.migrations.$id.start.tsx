import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { startMigration } from "../lib/services/orchestrator.service";
import { logEvent } from "../lib/services/migrationJob.service";
import type { ScanSummary } from "../lib/services/scan.service";
import {
  liveMissingAppPermissions,
  needsPermissionRescan,
} from "../lib/services/permissionStatus.server";
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
    include: {
      storeConnection: { include: { sourceShop: true, destinationShop: true } },
    },
  });
  if (!job) {
    return redirect("/app/migrations");
  }

  if (job.status !== "SCANNED") {
    return redirect(`/app/migrations/${job.id}/scan`);
  }

  const scanSummary = job.scanSummary as ScanSummary | null;
  const storeScopes = {
    sourceScope: job.storeConnection.sourceShop.scope,
    destinationScope: job.storeConnection.destinationShop.scope,
    sourceShopDomain: job.storeConnection.sourceShop.shopDomain,
    destinationShopDomain: job.storeConnection.destinationShop.shopDomain,
  };
  const selectedResources = job.selectedResources as string[];
  const missingPermissions = liveMissingAppPermissions(storeScopes);
  if (missingPermissions.length > 0) {
    await logEvent(
      job.id,
      "WARN",
      "Migration start blocked because required permissions are missing",
      {
        missingPermissions,
      },
    );
    return redirect(`/app/migrations/${job.id}/scan`);
  }

  if (needsPermissionRescan(scanSummary, selectedResources, storeScopes)) {
    await logEvent(
      job.id,
      "WARN",
      "Migration start blocked because the scan must be rerun after permissions changed",
    );
    return redirect(`/app/migrations/${job.id}/scan`);
  }

  await db.migrationJob.update({
    where: { id: job.id },
    data: { status: "QUEUED" },
  });
  try {
    const { migrationQueue } = await import("../lib/queue/queues");
    await migrationQueue.add("run", { migrationJobId: job.id, mode: "start" });
  } catch (error) {
    console.warn(
      "Migration queue unavailable; running migration inline",
      error,
    );
    await startMigration(job.id);
  }

  return redirect(`/app/migrations/${job.id}/progress`);
};
