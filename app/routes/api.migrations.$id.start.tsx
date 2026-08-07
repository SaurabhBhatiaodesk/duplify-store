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
  storeScopesFromConnection,
} from "../lib/services/permissionStatus.server";
import { migrationJobForShopWhere } from "../lib/services/storeConnection.service";
import { verifyMigrationStoreAccess } from "../lib/services/shopAccess.server";
import { enqueueOrRunInline } from "../lib/queue/enqueueOrRun.server";

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
  const storeScopes = storeScopesFromConnection(job.storeConnection);
  const selectedResources = job.selectedResources as string[];
  const missingPermissions = liveMissingAppPermissions(storeScopes);
  if (missingPermissions.length > 0) {
    await logEvent(
      job.id,
      "WARN",
      "Migration start blocked because a store needs reconnect",
      {
        missingPermissions,
      },
    );
    return redirect(`/app/migrations/${job.id}/scan`);
  }

  // Live API ping — do not start if Shopify still rejects a store token.
  const badShop = await verifyMigrationStoreAccess(job.storeConnection);
  if (badShop) {
    await logEvent(
      job.id,
      "WARN",
      `Migration start blocked: reconnect ${badShop} (invalid access token)`,
    );
    return redirect(`/app/migrations/${job.id}/scan`);
  }

  if (needsPermissionRescan(scanSummary, selectedResources, storeScopes)) {
    await logEvent(
      job.id,
      "INFO",
      "Starting migration after a fresh access check",
    );
  }

  await db.migrationJob.update({
    where: { id: job.id },
    data: { status: "QUEUED" },
  });
  const { migrationQueue } = await import("../lib/queue/queues");
  await enqueueOrRunInline({
    queue: migrationQueue,
    jobName: "run",
    data: { migrationJobId: job.id, mode: "start" as const },
    runInline: () => startMigration(job.id),
    label: "migration-start",
  });

  return redirect(`/app/migrations/${job.id}/progress`);
};
