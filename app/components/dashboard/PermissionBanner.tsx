import { useId, useState } from "react";
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
  const installModalId = useId().replace(/:/g, "");
  const [copied, setCopied] = useState(false);

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

  async function copyInstallUrl() {
    if (!sourceInstallHref) return;
    try {
      await navigator.clipboard.writeText(sourceInstallHref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the field so the merchant can Ctrl+C.
      const input = document.getElementById(
        `${installModalId}-url`,
      ) as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <>
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
            command="--show"
            commandFor={installModalId}
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

      {hasSourceMissing && sourceInstallHref && (
        <s-modal id={installModalId} heading="Install on source store">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Is URL ko copy karke source store (
              {sourceShopDomain ?? "source"}) ke browser mein paste karo,
              Install allow karo, app ek baar open karo, phir yahan wapas aao.
            </s-paragraph>
            <s-text-field
              id={`${installModalId}-url`}
              label="Install URL"
              value={sourceInstallHref}
              readOnly
            />
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={() => {
              void copyInstallUrl();
            }}
          >
            {copied ? "Copied" : "Copy URL"}
          </s-button>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            href={sourceInstallHref}
            target="_blank"
          >
            Open link
          </s-button>
          <s-button
            slot="secondary-actions"
            command="--hide"
            commandFor={installModalId}
          >
            Close
          </s-button>
        </s-modal>
      )}
    </>
  );
}
