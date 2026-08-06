import { useId } from "react";
import { Form, useLocation } from "react-router";

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
  const destinationScopeFormId = useId();
  const hasMissingPermissions = missing.some((m) => m.missing.length > 0);
  const hasSourceMissing = missing.some((m) => m.shopRole === "source");
  const hasDestinationMissing = missing.some((m) => m.shopRole !== "source");
  const sourceShopDomain = missing.find(
    (m) => m.shopRole === "source" && m.shopDomain,
  )?.shopDomain;
  const destinationScopes = Array.from(
    new Set(
      missing
        .filter((item) => item.shopRole !== "source")
        .flatMap((item) => item.missing),
    ),
  );

  if (!hasMissingPermissions) return null;

  const sourceHandle = sourceShopDomain
    ?.replace(/\.myshopify\.com$/i, "")
    .trim();
  const sourceInstallHref = sourceHandle
    ? `https://admin.shopify.com/store/${sourceHandle}/oauth/install?client_id=17baeffee1331390a337b79633f40149`
    : undefined;

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
        <>
          <Form
            id={destinationScopeFormId}
            method="post"
            action="/api/scopes/request"
            style={{ display: "none" }}
          >
            {destinationScopes.map((scope) => (
              <input key={scope} type="hidden" name="scopes" value={scope} />
            ))}
            <input
              type="hidden"
              name="returnTo"
              value={`${location.pathname}${location.search}`}
            />
          </Form>
          <s-button
            slot={hasSourceMissing ? "secondary-actions" : "primary-action"}
            variant={hasSourceMissing ? "secondary" : "primary"}
            onClick={() => {
              const form = document.getElementById(
                destinationScopeFormId,
              ) as HTMLFormElement | null;
              form?.requestSubmit();
            }}
          >
            Update this store
          </s-button>
        </>
      )}
    </s-banner>
  );
}
