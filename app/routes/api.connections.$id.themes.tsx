import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  createAdminClient,
  ShopifyGraphqlError,
} from "../lib/shopify/admin-client";
import { THEMES_BY_NAME_QUERY } from "../lib/shopify/queries/theme";

interface ThemesResponse {
  themes: {
    edges: Array<{ node: { id: string; name: string; role: string } }>;
  };
}

function hasScope(grantedScope: string, requiredScope: string) {
  return new Set(
    grantedScope
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  ).has(requiredScope);
}

function missingThemesScopeResponse() {
  return Response.json({ themes: [], missingScopes: ["read_themes"] });
}

function isThemesScopeError(error: unknown) {
  if (!(error instanceof ShopifyGraphqlError)) return false;
  return (
    error.message.includes("read_themes") ||
    (error.message.includes("Access denied") &&
      error.message.includes("themes field"))
  );
}

// Backs the theme picker in the New Migration form — lists every theme on
// the connection's *source* store so the merchant can migrate a specific
// (e.g. unpublished/staging) theme instead of always the live one.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });

  const connection = await db.storeConnection.findFirstOrThrow({
    where: { id: params.id, ownerShopId: shop.id },
    include: { sourceShop: true },
  });

  if (!hasScope(connection.sourceShop.scope, "read_themes")) {
    return missingThemesScopeResponse();
  }

  const sourceAdmin = createAdminClient(connection.sourceShop);
  let result: ThemesResponse;
  try {
    result = await sourceAdmin.graphql<ThemesResponse>(
      THEMES_BY_NAME_QUERY,
      undefined,
      10,
    );
  } catch (error) {
    if (isThemesScopeError(error)) {
      return missingThemesScopeResponse();
    }
    throw error;
  }

  return Response.json({
    themes: result.themes.edges.map((e) => ({
      id: e.node.id,
      name: e.node.name,
      role: e.node.role,
    })),
  });
};
