import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isRequestableScope } from "../lib/shopify/scopes";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // If someone lands here via a full-page navigation (old broken button),
  // authenticate then bounce back into the embedded app shell.
  await authenticate.admin(request);
  return redirect("/app");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, scopes } = await authenticate.admin(request);
  const form = await request.formData();
  const scopesToRequest = Array.from(
    new Set(
      form
        .getAll("scopes")
        .map(String)
        .map((scope) => scope.trim())
        .filter(Boolean)
        .filter(isRequestableScope),
    ),
  );
  const returnTo = String(form.get("returnTo") || "/app");

  // Throws an App Bridge redirect to Shopify's install/consent screen when
  // scopes are not yet granted. Do not catch — React Router + App Bridge
  // must see that redirect response.
  await scopes.request(scopesToRequest);

  const scopeDetails = await scopes.query();
  await db.shop.update({
    where: { shopDomain: session.shop },
    data: { scope: scopeDetails.granted.join(",") },
  });

  return redirect(returnTo.startsWith("/app") ? returnTo : "/app");
};
