import db from "../../db.server";
import { encryptToken } from "../crypto/token-cipher";
import { isValidShopDomain } from "../shopify/shop-domain";
import { ADMIN_API_VERSION } from "../shopify/admin-client";
import { REQUESTED_SCOPES } from "../shopify/scopes";

// Alternative to the OAuth popup flow (auth.external.begin/callback) for
// connecting the "other" store — useful when the person operating this app
// doesn't have (and doesn't want to get) a Shopify login with access to that
// store: they instead ask whoever owns that store to create a Custom App
// there (Settings > Apps > Develop apps), grant it the scopes listed on the
// Connect Stores page, and hand over just the generated Admin API access
// token — nothing more sensitive than that ever has to change hands.

interface ShopCheckResponse {
  data?: { shop?: { name: string } };
  errors?: Array<{ message: string }>;
}

export type ConnectResult = { ok: true } | { ok: false; error: string };

export async function connectViaAccessToken(params: {
  ownerShopId: string;
  ownerRole: "SOURCE" | "DESTINATION";
  shopDomain: string;
  accessToken: string;
}): Promise<ConnectResult> {
  const shopDomain = params.shopDomain.trim().toLowerCase();
  const accessToken = params.accessToken.trim();

  if (!isValidShopDomain(shopDomain)) {
    return {
      ok: false,
      error: "Enter a valid shop domain, e.g. your-store.myshopify.com",
    };
  }
  if (!accessToken) {
    return { ok: false, error: "Enter an Admin API access token" };
  }

  const ownerShop = await db.shop.findUnique({
    where: { id: params.ownerShopId },
  });
  if (!ownerShop) {
    return { ok: false, error: "Current shop is not fully registered yet" };
  }
  if (shopDomain === ownerShop.shopDomain) {
    return {
      ok: false,
      error: "Source and destination stores must be different shops",
    };
  }

  // Verify the token actually works against this shop before storing
  // anything — a bad/expired/wrong-shop token should fail loudly here, not
  // silently at the first migration attempt.
  let shopCheck: ShopCheckResponse;
  try {
    const response = await fetch(
      `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query: "{ shop { name } }" }),
      },
    );
    if (response.status === 401 || response.status === 403) {
      const body = await response.text();
      console.error(
        `Manual connect token rejected for ${shopDomain}: ${response.status} ${body}`,
      );
      return {
        ok: false,
        error: `This access token was rejected by Shopify (${response.status}: ${body.slice(0, 200)}). Double-check it was copied in full (starts with "shpat_", ~38 chars total), the app is installed on that store, and the token hasn't been revoked/regenerated since.`,
      };
    }
    if (!response.ok) {
      const body = await response.text();
      console.error(
        `Manual connect unexpected status for ${shopDomain}: ${response.status} ${body}`,
      );
      return {
        ok: false,
        error: `Shopify returned an unexpected error (${response.status}): ${body.slice(0, 200)}`,
      };
    }
    shopCheck = (await response.json()) as ShopCheckResponse;
    if (shopCheck.errors && shopCheck.errors.length > 0) {
      console.error(
        `Manual connect GraphQL errors for ${shopDomain}:`,
        shopCheck.errors,
      );
      return {
        ok: false,
        error: `Shopify rejected the request: ${shopCheck.errors.map((e) => e.message).join("; ")}`,
      };
    }
  } catch {
    return {
      ok: false,
      error:
        "Could not reach that shop. Double-check the domain and try again.",
    };
  }

  if (!shopCheck.data?.shop) {
    return {
      ok: false,
      error:
        "Shopify accepted the request but didn't return shop data — the token may be missing required scopes.",
    };
  }

  // Access tokens don't self-report their granted scopes via GraphQL; the
  // classic REST endpoint does.
  let scope = "";
  try {
    const scopesResponse = await fetch(
      `https://${shopDomain}/admin/oauth/access_scopes.json`,
      {
        headers: { "X-Shopify-Access-Token": accessToken },
      },
    );
    if (scopesResponse.ok) {
      const body = (await scopesResponse.json()) as {
        access_scopes?: Array<{ handle: string }>;
      };
      scope = (body.access_scopes ?? []).map((s) => s.handle).join(",");
    }
  } catch {
    return {
      ok: false,
      error:
        "Could not verify the token's granted scopes. Recreate the custom app token with all required scopes and try again.",
    };
  }

  if (!scope) {
    return {
      ok: false,
      error:
        "Could not read the token's granted scopes. Recreate the custom app token with all required scopes and try again.",
    };
  }

  const grantedScopes = new Set(
    scope
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const missingScopes = REQUESTED_SCOPES.filter(
    (requiredScope) => !grantedScopes.has(requiredScope),
  );
  if (missingScopes.length > 0) {
    return {
      ok: false,
      error: `This token is missing required scopes: ${missingScopes.join(", ")}. Grant all required Admin API scopes, then install or regenerate the token again.`,
    };
  }

  const externalShop = await db.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      accessTokenEncrypted: encryptToken(accessToken),
      scope,
      isActive: true,
    },
    update: {
      accessTokenEncrypted: encryptToken(accessToken),
      scope,
      isActive: true,
      uninstalledAt: null,
    },
  });

  const sourceShopId =
    params.ownerRole === "SOURCE" ? ownerShop.id : externalShop.id;
  const destinationShopId =
    params.ownerRole === "DESTINATION" ? ownerShop.id : externalShop.id;

  await db.storeConnection.upsert({
    where: {
      sourceShopId_destinationShopId: { sourceShopId, destinationShopId },
    },
    create: {
      ownerShopId: ownerShop.id,
      sourceShopId,
      destinationShopId,
      status: "READY",
    },
    update: { status: "READY" },
  });

  return { ok: true };
}
