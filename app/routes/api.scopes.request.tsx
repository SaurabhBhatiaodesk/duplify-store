import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect("/app/settings");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, scopes } = await authenticate.admin(request);
  const form = await request.formData();
  const scopesToRequest = Array.from(
    new Set(form.getAll("scopes").map(String).map((scope) => scope.trim()).filter(Boolean)),
  );
  const returnTo = String(form.get("returnTo") || "/app/settings");

  await scopes.request(scopesToRequest);

  const scopeDetails = await scopes.query();
  await db.shop.update({
    where: { shopDomain: session.shop },
    data: { scope: scopeDetails.granted.join(",") },
  });

  return redirect(returnTo.startsWith("/app") ? returnTo : "/app/settings");
};
