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
import {
  missingRequestedScopes,
  REQUESTED_SCOPES,
} from "../lib/shopify/scopes";
import { StatusBadge } from "../components/dashboard/StatusBadge";
import { EmptyState } from "../components/shared/EmptyState";
import { ConfirmDestructiveModal } from "../components/shared/ConfirmDestructiveModal";
import { PermissionBanner } from "../components/dashboard/PermissionBanner";
import type { action as installPairAction } from "./api.connections.install-pair";

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
  const { currentShopDomain, connections } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [otherShop, setOtherShop] = useState("");
  const installPair = useFetcher<typeof installPairAction>();
  const isPairing = installPair.state !== "idle";
  const shopify = useAppBridge();

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
    if (installPair.state === "idle" && installPair.data?.ok) {
      setOtherShop("");
      shopify.toast.show("Source store connected");
      revalidator.revalidate();
    }
  }, [installPair.state, installPair.data, revalidator, shopify]);

  const sourceHandle = otherShop
    .trim()
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "");
  const sourceInstallHref = sourceHandle
    ? `https://admin.shopify.com/store/${sourceHandle}/oauth/install?client_id=17baeffee1331390a337b79633f40149`
    : "https://admin.shopify.com/oauth/install?client_id=17baeffee1331390a337b79633f40149";

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

      <s-section heading="How it works">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            1. Install Duplify on the source store and open it once.
            <br />
            2. Come back to this store and enter the source domain.
            <br />
            3. Connect — import starts from there.
          </s-paragraph>
          <s-paragraph>
            This store (<s-text type="strong">{currentShopDomain}</s-text>) is
            the destination.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Connect source store">
        <installPair.Form method="post" action="/api/connections/install-pair">
          <s-stack direction="block" gap="base">
            <s-text-field
              name="sourceShopDomain"
              label="Source store domain"
              placeholder="source-store.myshopify.com"
              value={otherShop}
              onChange={(e) => setOtherShop(e.currentTarget.value)}
            ></s-text-field>
            {installPair.data && !installPair.data.ok && (
              <s-banner tone="critical" heading="Couldn't connect">
                <s-paragraph>{installPair.data.error}</s-paragraph>
                {"needsInstall" in installPair.data &&
                  installPair.data.needsInstall && (
                    <s-paragraph>
                      <s-link href={sourceInstallHref} target="_blank">
                        Install Duplify on source store
                      </s-link>
                    </s-paragraph>
                  )}
              </s-banner>
            )}
            {installPair.data?.ok && (
              <s-banner tone="success" heading="Source store connected" />
            )}
            <s-button
              type="submit"
              variant="primary"
              {...(isPairing ? { loading: true } : {})}
            >
              Connect source store
            </s-button>
          </s-stack>
        </installPair.Form>
      </s-section>

      <s-section heading="Connected store pairs">
        {connections.length === 0 ? (
          <EmptyState
            heading="No store pairs yet"
            message="Connect a source store to see it here."
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
                          message={`This won't delete anything already migrated between ${c.source} and ${c.destination}.`}
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
    </s-page>
  );
}
