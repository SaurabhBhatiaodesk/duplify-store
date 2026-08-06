import { useFetcher, useLocation } from "react-router";
import { isRequestableScope } from "../../lib/shopify/scopes";

interface PermissionBannerProps {
  missing: Array<{
    resourceType: string;
    missing: string[];
    shopRole?: "source" | "destination";
    shopDomain?: string;
  }>;
  authorizeHref: string;
}

export function PermissionBanner({ missing }: PermissionBannerProps) {
  const location = useLocation();
  const scopesFetcher = useFetcher();
  const isUpdating = scopesFetcher.state !== "idle";

  const hasMissingPermissions = missing.some((m) => m.missing.length > 0);
  const hasSourceMissing = missing.some((m) => m.shopRole === "source");
  const sourceShopDomain = missing.find(
    (m) => m.shopRole === "source" && m.shopDomain,
  )?.shopDomain;

  // Only scopes Shopify can actually grant via the in-app update flow.
  // Protected scopes (e.g. read_all_orders) stay out of this button.
  const destinationScopes = Array.from(
    new Set(
      missing
        .filter((item) => item.shopRole !== "source")
        .flatMap((item) => item.missing)
        .filter(isRequestableScope),
    ),
  );
  const hasDestinationMissing = destinationScopes.length > 0;

  if (!hasMissingPermissions) return null;

  const sourceHandle = sourceShopDomain
    ?.replace(/\.myshopify\.com$/i, "")
    .trim();
  const sourceInstallHref = sourceHandle
    ? `https://admin.shopify.com/store/${sourceHandle}/oauth/install?client_id=17baeffee1331390a337b79633f40149`
    : undefined;

  function requestDestinationScopes() {
    if (destinationScopes.length === 0 || isUpdating) return;
    const data = new FormData();
    for (const scope of destinationScopes) {
      data.append("scopes", scope);
    }
    data.set("returnTo", `${location.pathname}${location.search}`);
    // useFetcher keeps the request inside App Bridge so Shopify can handle the
    // install/scopes redirect. A native form POST navigates the iframe to
    // /api/scopes/request and leaves a blank page.
    scopesFetcher.submit(data, {
      method: "post",
      action: "/api/scopes/request",
    });
  }

  return (
    <s-banner
      tone="warning"
      heading={
        hasSourceMissing
          ? "Source store needs Duplify installed"
          : "Store update needed"
      }
    >
      <s-stack direction="block" gap="base">
        <s-paragraph>
          {hasSourceMissing && sourceShopDomain
            ? `Install Duplify Store on ${sourceShopDomain}, open the app once, then return here.`
            : "Update this store's access before importing can start."}
        </s-paragraph>
      </s-stack>

      {hasSourceMissing && sourceInstallHref && (
        <s-button
          slot="primary-action"
          variant="primary"
          href={sourceInstallHref}
          target="_blank"
        >
          Install on source store
        </s-button>
      )}

      {hasDestinationMissing && (
        <s-button
          slot={hasSourceMissing ? "secondary-actions" : "primary-action"}
          variant={hasSourceMissing ? "secondary" : "primary"}
          loading={isUpdating}
          onClick={requestDestinationScopes}
        >
          Update this store
        </s-button>
      )}
    </s-banner>
  );
}
