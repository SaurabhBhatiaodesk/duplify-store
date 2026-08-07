import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
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
    currentShopId: shop.id,
    currentShopDomain: shop.shopDomain,
    connections: connections.map((c) => ({
      id: c.id,
      source: c.sourceShop.shopDomain,
      destination: c.destinationShop.shopDomain,
      status: c.status,
      ownerShopId: c.ownerShopId,
      createdAt: c.createdAt,
    })),
  };
};

export default function ConnectStores() {
  const { currentShopId, currentShopDomain, connections } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [otherShop, setOtherShop] = useState("");
  const [copiedInstallUrl, setCopiedInstallUrl] = useState(false);
  // DESTINATION = import into this store; SOURCE = export from this store
  const [currentRole, setCurrentRole] = useState<"DESTINATION" | "SOURCE">(
    "DESTINATION",
  );
  const installPair = useFetcher<typeof installPairAction>();
  const decision = useFetcher<{ ok: boolean; error?: string }>();
  const isPairing = installPair.state !== "idle";
  const shopify = useAppBridge();
  const wasPairing = useRef(false);

  useEffect(() => {
    if (installPair.state !== "idle") {
      wasPairing.current = true;
      return;
    }
    if (!wasPairing.current || !installPair.data?.ok) return;
    wasPairing.current = false;
    setOtherShop("");
    const pending =
      "pending" in installPair.data && installPair.data.pending === true;
    shopify.toast.show(
      pending
        ? "Approval requested — open Duplify on the other store to Accept"
        : "Stores connected",
    );
    revalidator.revalidate();
  }, [installPair.state, installPair.data, revalidator, shopify]);

  useEffect(() => {
    if (decision.state !== "idle" || !decision.data) return;
    if (decision.data.ok) {
      shopify.toast.show("Connection updated");
      revalidator.revalidate();
    } else if (decision.data.error) {
      shopify.toast.show(decision.data.error, { isError: true });
    }
  }, [decision.state, decision.data, revalidator, shopify]);

  const otherHandle = otherShop
    .trim()
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "");
  const otherInstallHref = otherHandle
    ? `https://admin.shopify.com/store/${otherHandle}/oauth/install?client_id=17baeffee1331390a337b79633f40149`
    : "https://admin.shopify.com/oauth/install?client_id=17baeffee1331390a337b79633f40149";
  const installModalId = "connect-install-url-modal";

  async function copyOtherInstallUrl() {
    try {
      await navigator.clipboard.writeText(otherInstallHref);
      setCopiedInstallUrl(true);
      window.setTimeout(() => setCopiedInstallUrl(false), 2000);
    } catch {
      const input = document.getElementById(
        `${installModalId}-url`,
      ) as HTMLInputElement | null;
      input?.select();
    }
  }

  const sourceLabel =
    currentRole === "DESTINATION" ? otherShop || "—" : currentShopDomain;
  const destinationLabel =
    currentRole === "DESTINATION" ? currentShopDomain : otherShop || "—";

  return (
    <s-page heading="Import / Export" inlineSize="large">
      <s-section heading="Choose what you want">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text type="strong">Import</s-text> brings data from another store
            into this store.
            <br />
            <s-text type="strong">Export</s-text> sends this store’s data to
            another store.
          </s-paragraph>
          <s-paragraph color="subdued">
            Both stores must install Duplify. After you request a connection,
            the other store must open Duplify and Accept before migration can
            start.
          </s-paragraph>

          <s-stack direction="inline" gap="base">
            <s-button
              variant={currentRole === "DESTINATION" ? "primary" : "secondary"}
              onClick={() => setCurrentRole("DESTINATION")}
            >
              Import
            </s-button>
            <s-button
              variant={currentRole === "SOURCE" ? "primary" : "secondary"}
              onClick={() => setCurrentRole("SOURCE")}
            >
              Export
            </s-button>
          </s-stack>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="base"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Source (where data comes from)</s-text>
              <s-text>{sourceLabel || "—"}</s-text>
              <s-text type="strong">Destination (where data goes)</s-text>
              <s-text>{destinationLabel || "—"}</s-text>
            </s-stack>
          </s-box>

          <installPair.Form
            method="post"
            action="/api/connections/install-pair"
          >
            <input type="hidden" name="currentRole" value={currentRole} />
            <s-stack direction="block" gap="base">
              <s-text-field
                name="otherShopDomain"
                label={
                  currentRole === "DESTINATION"
                    ? "Source store (copy from)"
                    : "Destination store (copy to)"
                }
                placeholder="other-store.myshopify.com"
                value={otherShop}
                onChange={(e) => setOtherShop(e.currentTarget.value)}
              ></s-text-field>

              {otherHandle && (
                <s-paragraph>
                  First install Duplify on the other store:{" "}
                  <s-button
                    variant="tertiary"
                    command="--show"
                    commandFor={installModalId}
                  >
                    Copy install URL
                  </s-button>
                </s-paragraph>
              )}

              {installPair.data && !installPair.data.ok && (
                <s-banner tone="critical" heading="Couldn't connect">
                  <s-paragraph>{installPair.data.error}</s-paragraph>
                  {"needsInstall" in installPair.data &&
                    installPair.data.needsInstall && (
                      <s-paragraph>
                        <s-button
                          variant="tertiary"
                          command="--show"
                          commandFor={installModalId}
                        >
                          Copy install URL
                        </s-button>
                      </s-paragraph>
                    )}
                </s-banner>
              )}
              {installPair.data?.ok && (
                <s-banner
                  tone="success"
                  heading={
                    "pending" in installPair.data && installPair.data.pending
                      ? "Waiting for the other store"
                      : "Stores connected"
                  }
                >
                  {"pending" in installPair.data && installPair.data.pending ? (
                    <s-paragraph>
                      Open Duplify on the other store, go to Import / Export,
                      and click Accept.
                    </s-paragraph>
                  ) : null}
                </s-banner>
              )}

              <s-button
                type="submit"
                variant="primary"
                {...(isPairing ? { loading: true } : {})}
              >
                Request connection
              </s-button>
            </s-stack>
          </installPair.Form>
        </s-stack>
      </s-section>

      <s-section heading="Connected stores">
        {connections.length === 0 ? (
          <EmptyState
            heading="No stores connected yet"
            message="Choose source and destination, then request a connection."
          />
        ) : (
          <s-stack direction="block" gap="base">
            {connections.map((c) => {
              const modalId = `disconnect-modal-${c.id}`;
              const canAccept =
                c.status === "PENDING" && c.ownerShopId !== currentShopId;
              const isWaiting =
                c.status === "PENDING" && c.ownerShopId === currentShopId;
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
                            {isWaiting && (
                              <s-text color="subdued">
                                Waiting for the other store to Accept
                              </s-text>
                            )}
                            {c.status === "READY" && (
                              <s-link href={`/app?connectionId=${c.id}`}>
                                Start import
                              </s-link>
                            )}
                          </s-stack>
                        </s-stack>
                      </s-grid-item>
                      <s-grid-item>
                        <s-stack direction="inline" gap="small-200">
                          {canAccept && (
                            <>
                              <decision.Form
                                method="post"
                                action={`/api/connections/${c.id}/accept`}
                              >
                                <s-button type="submit" variant="primary">
                                  Accept
                                </s-button>
                              </decision.Form>
                              <decision.Form
                                method="post"
                                action={`/api/connections/${c.id}/decline`}
                              >
                                <s-button type="submit" variant="secondary">
                                  Decline
                                </s-button>
                              </decision.Form>
                            </>
                          )}
                          <ConfirmDestructiveModal
                            id={modalId}
                            heading="Disconnect this store pair?"
                            message={`This won't delete anything already migrated between ${c.source} and ${c.destination}.`}
                            confirmLabel="Disconnect"
                            triggerLabel="Disconnect"
                            formAction={`/api/connections/${c.id}/disconnect`}
                          />
                        </s-stack>
                      </s-grid-item>
                    </s-grid>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>

      <s-modal id={installModalId} heading="Install Duplify on the other store">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Copy this URL, paste it in a browser signed into the other store,
            Allow install, open the app once, then return here and request the
            connection. The other store must Accept before you can migrate.
          </s-paragraph>
          <s-text-field
            id={`${installModalId}-url`}
            label="Install URL"
            value={otherInstallHref}
            readOnly
          />
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => {
            void copyOtherInstallUrl();
          }}
        >
          {copiedInstallUrl ? "Copied" : "Copy URL"}
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          command="--hide"
          commandFor={installModalId}
        >
          Close
        </s-button>
      </s-modal>
    </s-page>
  );
}
