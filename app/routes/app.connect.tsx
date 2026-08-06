import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Form,
  useFetcher,
  useLoaderData,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listConnectionsForOwner } from "../lib/services/storeConnection.service";
import { StatusBadge } from "../components/dashboard/StatusBadge";
import { EmptyState } from "../components/shared/EmptyState";
import { ConfirmDestructiveModal } from "../components/shared/ConfirmDestructiveModal";
import type { action as installPairAction } from "./api.connections.install-pair";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });

  const connections = await listConnectionsForOwner(shop.id);

  return {
    currentShopDomain: shop.shopDomain,
    connections: connections.map((c) => ({
      id: c.id,
      source: c.sourceShop.shopDomain,
      destination: c.destinationShop.shopDomain,
      status: c.status,
      createdAt: c.createdAt,
    })),
  };
};

export default function ConnectStores() {
  const { currentShopDomain, connections } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [otherShop, setOtherShop] = useState("");
  const installPair = useFetcher<typeof installPairAction>();
  const isPairing = installPair.state !== "idle";
  const shopify = useAppBridge();

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
      <s-section heading="Connect source store">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Install Duplify on the source store, open it once, then enter that
            domain here. Data will import into{" "}
            <s-text type="strong">{currentShopDomain}</s-text>.
          </s-paragraph>

          <installPair.Form
            method="post"
            action="/api/connections/install-pair"
          >
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
        </s-stack>
      </s-section>

      <s-section heading="Connected stores">
        {connections.length === 0 ? (
          <EmptyState
            heading="No source store yet"
            message="Connect a source store to start importing."
          />
        ) : (
          <s-stack direction="block" gap="base">
            {connections.map((c) => {
              const modalId = `disconnect-modal-${c.id}`;
              const formId = `disconnect-form-${c.id}`;
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
                            {c.status === "READY" && (
                              <s-link href={`/app?connectionId=${c.id}`}>
                                Start import
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
