import { existsSync, readFileSync } from "node:fs";

interface ShopifyDevManifest {
  modules?: Array<{
    type?: string;
    config?: { app_url?: unknown };
  }>;
}

// Shopify CLI's Quick Tunnel changes on every local dev session. Its generated
// manifest is the source of truth for the callback URLs Shopify has allow-
// listed for that session. Production never reads this file and must provide a
// stable SHOPIFY_APP_URL.
function activeDevTunnelUrl(): string | null {
  if (process.env.NODE_ENV === "production") return null;

  const manifestPath = ".shopify/dev-bundle/manifest.json";
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as ShopifyDevManifest;
    const appUrl = manifest.modules?.find(
      (module) => module.type === "app_home",
    )?.config?.app_url;
    return typeof appUrl === "string" ? appUrl : null;
  } catch {
    return null;
  }
}

export function externalOAuthAppUrl(request: Request): string {
  return (
    activeDevTunnelUrl() ??
    process.env.SHOPIFY_APP_URL ??
    new URL(request.url).origin
  );
}
