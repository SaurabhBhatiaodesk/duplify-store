import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Form,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listConnectionsForOwner } from "../lib/services/storeConnection.service";
import { isValidShopDomain } from "../lib/shopify/shop-domain";
import {
  missingRequestedScopes,
  REQUESTED_SCOPES,
} from "../lib/shopify/scopes";
import { StatusBadge } from "../components/dashboard/StatusBadge";
import { EmptyState } from "../components/shared/EmptyState";
import { ConfirmDestructiveModal } from "../components/shared/ConfirmDestructiveModal";
import { PermissionBanner } from "../components/dashboard/PermissionBanner";
import type { action as manualConnectAction } from "./api.connections.manual-connect";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });

  const connections = await listConnectionsForOwner(shop.id);

  return {
    currentShopDomain: shop.shopDomain,
    requiredScopes: REQUESTED_SCOPES,
    connections: connections.map((c) => ({
      id: c.id,
      source: c.sourceShop.shopDomain,
      destination: c.destinationShop.shopDomain,
      status: c.status,
      createdAt: c.createdAt,
      sourceMissingScopes: missingRequestedScopes(c.sourceShop.scope),
      destinationMissingScopes: missingRequestedScopes(c.destinationShop.scope),
    })),
  };
};

export default function ConnectStores() {
  const { currentShopDomain, requiredScopes, connections } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const currentRole: "DESTINATION" = "DESTINATION";
  const [otherShop, setOtherShop] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");

  const manualConnect = useFetcher<typeof manualConnectAction>();
  const isConnecting = manualConnect.state !== "idle";
  const shopify = useAppBridge();
  const [isCopyingLink, setIsCopyingLink] = useState(false);
  const [showTokenConnect, setShowTokenConnect] = useState(false);
  const permissionConnection = connections.find(
    (connection) => connection.id === searchParams.get("connectionId"),
  );
  const showPermissionNotice = searchParams.get("permissions") === "missing";
  const permissionMissing = permissionConnection
    ? [
        {
          resourceType: "app permissions",
          missing: permissionConnection.sourceMissingScopes,
          shopRole: "source" as const,
          shopDomain: permissionConnection.source,
        },
        {
          resourceType: "app permissions",
          missing: permissionConnection.destinationMissingScopes,
          shopRole: "destination" as const,
          shopDomain: permissionConnection.destination,
        },
      ].filter((permission) => permission.missing.length > 0)
    : [];
  const permissionAuthorizeHref = permissionConnection
    ? `/auth/external/begin?shop=${encodeURIComponent(permissionConnection.source)}&role=SOURCE`
    : "/app/connect";

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.source === "duplify-external-oauth") {
        revalidator.revalidate();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [revalidator]);

  useEffect(() => {
    if (manualConnect.state === "idle" && manualConnect.data?.ok) {
      setOtherShop("");
      setAccessToken("");
    }
  }, [manualConnect.state, manualConnect.data]);

  const otherRole = currentRole === "DESTINATION" ? "SOURCE" : "DESTINATION";

  function validatedDomain(): string | null {
    const domain = otherShop.trim().toLowerCase();
    if (!isValidShopDomain(domain)) {
      setError("Enter a valid shop domain, e.g. your-store.myshopify.com");
      return null;
    }
    setError(null);
    return domain;
  }

  async function copyConnectLink() {
    const domain = validatedDomain();
    if (!domain) return;

    setIsCopyingLink(true);
    try {
      const response = await fetch(
        `/api/connections/external-link?shop=${encodeURIComponent(domain)}&role=${otherRole}`,
      );
      const data = (await response.json()) as { url?: string; error?: string };
      if (!data.url) {
        setError(data.error ?? "Could not generate a link");
        return;
      }
      await navigator.clipboard.writeText(data.url);
      shopify.toast.show(
        "Approval link copied — send it to the source-store admin",
      );
    } catch {
      setError("Could not copy the link. Try again.");
    } finally {
      setIsCopyingLink(false);
    }
  }

  return (
    <s-page heading="Set up your import" inlineSize="large">
      {showPermissionNotice &&
        (permissionMissing.length > 0 ? (
          <PermissionBanner
            missing={permissionMissing}
            authorizeHref={permissionAuthorizeHref}
          />
        ) : (
          <s-banner tone="success" heading="Permissions are up to date">
            <s-paragraph>
              This store pair has every required Admin API permission.
            </s-paragraph>
          </s-banner>
        ))}

      <s-section heading="Destination store">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text>{currentShopDomain}</s-text> is the store you are using now.
            Data from the other store will be copied into this store.
          </s-paragraph>
        </s-stack>
      </s-section>
      <s-section heading="Step 1: Get source-store approval">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Enter the store you want to copy from. We will create a secure
            approval link for that store's admin.
          </s-paragraph>
          <s-banner
            tone="info"
            heading="No account switching required"
          >
            <s-paragraph>
              Copy the approval link and send it to the source-store admin.
              They open it while logged into their Shopify store, approve
              access once, and then this import is ready to continue.
            </s-paragraph>
          </s-banner>

          <s-text-field
            label="Source store domain"
            placeholder="source-store.myshopify.com"
            value={otherShop}
            onChange={(e) => setOtherShop(e.currentTarget.value)}
            error={error ?? undefined}
          ></s-text-field>

          <s-stack direction="inline" gap="base">
            <s-button
              onClick={copyConnectLink}
              variant="primary"
              {...(isCopyingLink ? { loading: true } : {})}
            >
              Copy source approval link
            </s-button>
          </s-stack>

          <s-button onClick={() => setShowTokenConnect((value) => !value)}>
            {showTokenConnect
              ? "Hide access token option"
              : "Use Admin API access token instead"}
          </s-button>

          {showTokenConnect && (
            <manualConnect.Form
              method="post"
              action="/api/connections/manual-connect"
            >
              <input type="hidden" name="ownerRole" value={currentRole} />
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  padding: "14px",
                  border: "1px solid #dcdfe4",
                  borderRadius: "8px",
                  background: "#f6f6f7",
                }}
              >
                <s-paragraph>
                  Create a Custom App on the other store, grant every required
                  scope shown above, then paste its Admin API access token here.
                  Tokens with missing scopes are rejected.
                </s-paragraph>
                <s-text-field
                  name="shopDomain"
                  label="Shop domain"
                  placeholder="other-store.myshopify.com"
                  value={otherShop}
                  onChange={(e) => setOtherShop(e.currentTarget.value)}
                ></s-text-field>
                <s-password-field
                  name="accessToken"
                  label="Admin API access token"
                  placeholder="shpat_..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.currentTarget.value)}
                ></s-password-field>
                {manualConnect.data && !manualConnect.data.ok && (
                  <s-banner tone="critical" heading="Couldn't connect">
                    <s-paragraph>{manualConnect.data.error}</s-paragraph>
                  </s-banner>
                )}
                {manualConnect.data?.ok && (
                  <s-banner tone="success" heading="Store connected"></s-banner>
                )}
                <s-button
                  type="submit"
                  variant="primary"
                  {...(isConnecting ? { loading: true } : {})}
                >
                  Connect with token
                </s-button>
              </div>
            </manualConnect.Form>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Connected store pairs">
        {connections.length === 0 ? (
          <EmptyState
            heading="No store pairs yet"
            message="Once you connect a source and destination store, they'll show up here."
          />
        ) : (
          <s-stack direction="block" gap="base">
            {connections.map((c) => {
              const modalId = `disconnect-modal-${c.id}`;
              const formId = `disconnect-form-${c.id}`;
              const missingPermissionCount = new Set([
                ...c.sourceMissingScopes,
                ...c.destinationMissingScopes,
              ]).size;
              return (
                <s-box
                  key={c.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="base"
                >
                  <s-stack direction="block" gap="small-300">
                    <s-grid
                      gridTemplateColumns="1fr auto"
                      gap="base"
                      alignItems="center"
                    >
                      <s-grid-item>
                        <s-stack direction="block" gap="small-300">
                          <s-heading>
                            {c.source} → {c.destination}
                          </s-heading>
                          <s-stack
                            direction="inline"
                            gap="small-300"
                            alignItems="center"
                          >
                            <StatusBadge status={c.status} />
                            {missingPermissionCount > 0 && (
                              <s-badge tone="warning">
                                {missingPermissionCount} permissions missing
                              </s-badge>
                            )}
                            {c.status === "READY" &&
                              missingPermissionCount === 0 && (
                              <s-link href={`/app?connectionId=${c.id}`}>
                                Start migration
                              </s-link>
                            )}
                            {missingPermissionCount > 0 && (
                              <s-link
                                href={`/app/connect?permissions=missing&connectionId=${c.id}`}
                              >
                                Review permissions
                              </s-link>
                            )}
                          </s-stack>
                        </s-stack>
                      </s-grid-item>
                      <s-grid-item>
                        <ConfirmDestructiveModal
                          id={modalId}
                          heading="Disconnect this store pair?"
                          message={`This won't delete anything already migrated between ${c.source} and ${c.destination} — their ID mappings and migration history stay put. You'd need to reconnect to run new migrations between them.`}
                          confirmLabel="Disconnect"
                          triggerLabel="Disconnect"
                          formId={formId}
                        />
                      </s-grid-item>
                    </s-grid>
                    <s-text color="subdued">
                      Connected since{" "}
                      {new Date(c.createdAt).toLocaleDateString()}
                    </s-text>
                  </s-stack>
                  <Form
                    method="post"
                    action={`/api/connections/${c.id}/disconnect`}
                    id={formId}
                    style={{ display: "none" }}
                  />
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="What can't be migrated">
        <s-unordered-list>
          <s-list-item>
            Customer passwords never transfer — customers must reset theirs
          </s-list-item>
          <s-list-item>
            Payment gateways, payouts, domains, billing and staff permissions
            are manual
          </s-list-item>
          <s-list-item>
            Third-party app data only migrates if that app exposes an
            export/import API
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
