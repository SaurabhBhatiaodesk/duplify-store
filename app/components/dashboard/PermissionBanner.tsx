import { useEffect, useId, useState } from "react";
import { Form, useLocation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

interface PermissionBannerProps {
  missing: Array<{
    resourceType: string;
    missing: string[];
    shopRole?: "source" | "destination";
    shopDomain?: string;
  }>;
  authorizeHref: string;
}

export function PermissionBanner({
  missing,
  authorizeHref,
}: PermissionBannerProps) {
  const location = useLocation();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const destinationScopeFormId = useId();
  const [isCopyingLink, setIsCopyingLink] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
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
  const heading =
    hasSourceMissing && !hasDestinationMissing
      ? "Source store approval needed"
      : hasSourceMissing && hasDestinationMissing
        ? "Store approval needed"
        : "Store update needed";

  useEffect(() => {
    function handleExternalOauth(event: MessageEvent) {
      if (event.data?.source === "duplify-external-oauth" && event.data?.ok) {
        revalidator.revalidate();
      }
    }

    window.addEventListener("message", handleExternalOauth);
    return () => window.removeEventListener("message", handleExternalOauth);
  }, [revalidator]);

  if (!hasMissingPermissions) return null;

  async function copySourceApprovalLink() {
    if (!sourceShopDomain) return;

    setIsCopyingLink(true);
    setCopyError(null);
    try {
      const response = await fetch(
        `/api/connections/external-link?shop=${encodeURIComponent(sourceShopDomain)}&role=SOURCE`,
      );
      const data = (await response.json()) as { url?: string; error?: string };
      if (!data.url) {
        setCopyError(data.error ?? "Could not generate an approval link");
        return;
      }
      await navigator.clipboard.writeText(data.url);
      shopify.toast.show(
        "Approval link copied — paste it in a browser logged into the source store",
      );
    } catch {
      setCopyError("Could not copy the link. Try again.");
    } finally {
      setIsCopyingLink(false);
    }
  }

  return (
    <s-banner tone="warning" heading={heading}>
      <s-stack direction="block" gap="base">
        <s-paragraph>
          {hasSourceMissing && hasDestinationMissing
            ? "The source-store admin needs to approve access, and this store needs a quick access update before importing can start."
            : hasSourceMissing
              ? "Ask the source-store admin to approve access before importing can start."
              : "Update this store's access before importing can start."}
        </s-paragraph>

        {hasSourceMissing && sourceShopDomain && (
          <s-stack direction="block" gap="small-200">
            <s-text type="strong">
              Approve with the source-store account
            </s-text>
            <s-paragraph>
              Copy the secure approval link, then paste it in a new or Incognito
              browser tab logged into{" "}
              <s-text type="strong">{sourceShopDomain}</s-text>. You can also
              send the link to that store's admin. The link expires after 10
              minutes and can be used once.
            </s-paragraph>
          </s-stack>
        )}

        {copyError && <s-paragraph>{copyError}</s-paragraph>}
      </s-stack>

      {hasSourceMissing && (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={copySourceApprovalLink}
            {...(isCopyingLink ? { loading: true } : {})}
          >
            Copy source approval link
          </s-button>
        </>
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
            Update store access
          </s-button>
        </>
      )}
    </s-banner>
  );
}
