import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const ACTIVE_STATUSES = new Set(["SCANNING", "QUEUED", "RUNNING"]);

export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect("/app/migrations");
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } });
  const form = await request.formData();
  const returnTo = String(form.get("returnTo") || "/app/migrations");

  const job = await db.migrationJob.findFirstOrThrow({
    where: { id: params.id, storeConnection: { ownerShopId: shop.id } },
  });

  if (ACTIVE_STATUSES.has(job.status)) {
    return redirect(returnTo.startsWith("/app") ? returnTo : "/app/migrations");
  }

  await db.$transaction([
    db.conflict.deleteMany({ where: { migrationJobId: job.id } }),
    db.migrationLog.deleteMany({ where: { migrationJobId: job.id } }),
    db.migrationItem.deleteMany({ where: { migrationJobId: job.id } }),
    db.migrationJob.delete({ where: { id: job.id } }),
  ]);

  return redirect(returnTo.startsWith("/app") ? returnTo : "/app/migrations");
};
