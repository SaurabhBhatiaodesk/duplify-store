import { useId, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { isRequestableScope } from "../../lib/shopify/scopes";

interface PermissionBannerProps {
  missing: Array<{
    resourceType: string;
    missing: string[];
    shopRole?: "source" | "destination";
    shopDomain?: string;
    installed?: boolean;
  }>;
  authorizeHref: string;
  currentShopDomain?: string;
}

function sameShop(a?: string, b?: string) {
  if (!a || !b) return false;
  return (
    a.replace(/\.myshopify\.com$/i, "").toLowerCase() ===
    b.replace(/\.myshopify\.com$/i, "").toLowerCase()
  );
}

export function PermissionBanner({
  missing,
  currentShopDomain,
}: PermissionBannerProps) {
  const location = useLocation();
  const scopesFetcher = useFetcher();
  const isUpdating = scopesFetcher.state !== "idle";
  const installModalId = useId().replace(/:/g, "");
  const [copied, setCopied] = useState(false);

  const hasMissingPermissions = missing.some((m) => m.missing.length > 0);
  if (!hasMissingPermissions) return null;

  const sourceEntry = missing.find((m) => m.shopRole === "source");
  const destinationEntry = missing.find((m) => m.shopRole !== "source");
  const sourceShopDomain = sourceEntry?.shopDomain;
  const destinationShopDomain = destinationEntry?.shopDomain;
  const sourceInstalled = sourceEntry ? sourceEntry.installed !== false : true;
  const sourceNeedsInstall = Boolean(
    sourceEntry?.missing.length && !sourceInstalled,
  );
  const sourceNeedsPermissions = Boolean(
    sourceEntry?.missing.length && sourceInstalled,
  );
  const destinationNeedsPermissions = Boolean(
    destinationEntry?.missing.length,
  );
  const sourceIsCurrent = sameShop(currentShopDomain, sourceShopDomain);
  const destinationIsCurrent = sameShop(
    currentShopDomain,
    destinationShopDomain,
  );

  const currentStoreScopes = Array.from(
    new Set(
      missing
        .filter((item) => sameShop(currentShopDomain, item.shopDomain))
        .flatMap((item) => item.missing)
        .filter(isRequestableScope),
    ),
  );

  const otherShopDomain =
    sourceIsCurrent
      ? destinationNeedsPermissions
        ? destinationShopDomain
        : undefined
      : destinationIsCurrent
        ? sourceNeedsInstall || sourceNeedsPermissions
          ? sourceShopDomain
          : undefined
        : sourceShopDomain ?? destinationShopDomain;

  const otherShopHandle = otherShopDomain
    ?.replace(/\.myshopify\.com$/i, "")
    .trim();
  const otherShopHref = otherShopHandle
    ? `https://admin.shopify.com/store/${otherShopHandle}/apps/duplify-store`
    : sourceShopDomain
      ? `https://admin.shopify.com/store/${sourceShopDomain.replace(/\.myshopify\.com$/i, "")}/oauth/install?client_id=17baeffee1331390a337b79633f40149`
      : undefined;
  const installHref = sourceShopDomain
    ? `https://admin.shopify.com/store/${sourceShopDomain.replace(/\.myshopify\.com$/i, "")}/oauth/install?client_id=17baeffee1331390a337b79633f40149`
    : undefined;

  function requestCurrentScopes() {
    if (currentStoreScopes.length === 0 || isUpdating) return;
    const data = new FormData();
    for (const scope of currentStoreScopes) {
      data.append("scopes", scope);
    }
    data.set("returnTo", `${location.pathname}${location.search}`);
    scopesFetcher.submit(data, {
      method: "post",
      action: "/api/scopes/request",
    });
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById(
        `${installModalId}-url`,
      ) as HTMLInputElement | null;
      input?.select();
    }
  }

  const heading = sourceNeedsInstall
    ? "Source store needs Duplify installed"
    : sourceNeedsPermissions
      ? "Source store needs permission update"
      : "Store update needed";

  const message = sourceNeedsInstall && sourceShopDomain
    ? `Install Duplify Store on ${sourceShopDomain}, open the app once, then return here.`
    : sourceNeedsPermissions && sourceShopDomain
      ? sourceIsCurrent
        ? `Duplify is already installed on ${sourceShopDomain}. Click Update to grant missing permissions.`
        : `Duplify is installed on ${sourceShopDomain}, but permissions are incomplete. Open that store and update access.`
      : destinationIsCurrent
        ? "Update this store's access before importing can start."
        : `Open ${destinationShopDomain ?? "the destination store"} and update Duplify permissions.`;

  const modalUrl = sourceNeedsInstall ? installHref : otherShopHref;

  return (
    <>
      <s-banner tone="warning" heading={heading}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{message}</s-paragraph>
        </s-stack>

        {currentStoreScopes.length > 0 && (
          <s-button
            slot="primary-action"
            variant="primary"
            loading={isUpdating}
            onClick={requestCurrentScopes}
          >
            Update this store
          </s-button>
        )}

        {sourceNeedsInstall && installHref && (
          <s-button
            slot={currentStoreScopes.length > 0 ? "secondary-actions" : "primary-action"}
            variant={currentStoreScopes.length > 0 ? "secondary" : "primary"}
            command="--show"
            commandFor={installModalId}
          >
            Install on source store
          </s-button>
        )}

        {!sourceNeedsInstall &&
          currentStoreScopes.length === 0 &&
          modalUrl && (
            <s-button
              slot="primary-action"
              variant="primary"
              command="--show"
              commandFor={installModalId}
            >
              Copy other store URL
            </s-button>
          )}
      </s-banner>

      {modalUrl && (
        <s-modal
          id={installModalId}
          heading={
            sourceNeedsInstall ? "Install on source store" : "Open other store"
          }
        >
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {sourceNeedsInstall
                ? `Is URL ko copy karke ${sourceShopDomain} ke browser mein paste karo, Install allow karo, app ek baar open karo, phir yahan wapas aao.`
                : `Is URL ko copy karke dusre store ke browser mein paste karo, Duplify open karo, permissions allow karo, phir yahan refresh karo.`}
            </s-paragraph>
            <s-text-field
              id={`${installModalId}-url`}
              label="URL"
              value={modalUrl}
              readOnly
            />
          </s-stack>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={() => {
              void copyUrl(modalUrl);
            }}
          >
            {copied ? "Copied" : "Copy URL"}
          </s-button>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            href={modalUrl}
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
