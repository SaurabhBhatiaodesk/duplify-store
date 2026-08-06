import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { REQUESTED_SCOPES, isRequestableScope } from "../lib/shopify/scopes";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });
  const setting = await db.appSetting.findUnique({
    where: { shopId: shop.id },
  });
  const connections = await db.storeConnection.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [
        { ownerShopId: shop.id },
        { sourceShopId: shop.id },
        { destinationShopId: shop.id },
      ],
    },
    select: {
      sourceShop: {
        select: { shopDomain: true, scope: true },
      },
      destinationShop: {
        select: { shopDomain: true, scope: true },
      },
    },
  });

  const stores = new Map<
    string,
    {
      shopDomain: string;
      scope: string;
      roles: Set<"Source" | "Destination">;
      isCurrent: boolean;
    }
  >();

  function addStore(
    connectedShop: { shopDomain: string; scope: string },
    role: "Source" | "Destination",
  ) {
    const existing = stores.get(connectedShop.shopDomain);
    if (existing) {
      existing.roles.add(role);
      return;
    }
    stores.set(connectedShop.shopDomain, {
      ...connectedShop,
      roles: new Set([role]),
      isCurrent: connectedShop.shopDomain === session.shop,
    });
  }

  addStore(shop, "Destination");
  for (const connection of connections) {
    addStore(connection.sourceShop, "Source");
    addStore(connection.destinationShop, "Destination");
  }

  return {
    shopDomain: shop.shopDomain,
    scope: shop.scope,
    permissionStores: Array.from(stores.values()).map((store) => {
      const granted = new Set(parseScopes(store.scope));
      const missingScopes = REQUESTED_SCOPES.filter(
        (scope) => !granted.has(scope),
      );
      return {
        shopDomain: store.shopDomain,
        roles: Array.from(store.roles),
        isCurrent: store.isCurrent,
        grantedCount: REQUESTED_SCOPES.length - missingScopes.length,
        requiredCount: REQUESTED_SCOPES.length,
        missingScopes,
      };
    }),
    notificationEmail: setting?.notificationEmail ?? "",
    timezone: setting?.timezone ?? "UTC",
    defaultConflictStrategy:
      (setting?.defaultConflictStrategy as { default?: string } | null)
        ?.default ?? "SKIP",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({
    where: { shopDomain: session.shop },
  });
  const form = await request.formData();

  await db.appSetting.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      notificationEmail: String(form.get("notificationEmail") || "") || null,
      timezone: String(form.get("timezone") || "UTC"),
      defaultConflictStrategy: {
        default: String(form.get("defaultConflictStrategy") || "SKIP"),
      },
    },
    update: {
      notificationEmail: String(form.get("notificationEmail") || "") || null,
      timezone: String(form.get("timezone") || "UTC"),
      defaultConflictStrategy: {
        default: String(form.get("defaultConflictStrategy") || "SKIP"),
      },
    },
  });

  return { saved: true };
};

function parseScopes(scope: string) {
  return Array.from(
    new Set(
      scope
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).sort();
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const grantedScopes = parseScopes(data.scope || "");
  const missingScopes = REQUESTED_SCOPES.filter(
    (scope) => !grantedScopes.includes(scope) && isRequestableScope(scope),
  );
  const scopesFetcher = useFetcher();
  const isRequestingScopes = scopesFetcher.state !== "idle";

  function requestAllPermissions() {
    if (missingScopes.length === 0 || isRequestingScopes) return;
    const form = new FormData();
    for (const scope of REQUESTED_SCOPES.filter(isRequestableScope)) {
      form.append("scopes", scope);
    }
    form.set("returnTo", "/app/settings");
    scopesFetcher.submit(form, {
      method: "post",
      action: "/api/scopes/request",
    });
  }

  // "baseline" is the last-saved value the save bar's dirty check compares
  // against — starts from the loader, and is advanced (not the loader data
  // itself, which useLoaderData treats as read-only) after a successful save.
  const [baseline, setBaseline] = useState({
    notificationEmail: data.notificationEmail,
    timezone: data.timezone,
    defaultConflictStrategy: data.defaultConflictStrategy,
  });

  const [notificationEmail, setNotificationEmail] = useState(
    baseline.notificationEmail,
  );
  const [timezone, setTimezone] = useState(baseline.timezone);
  const [defaultConflictStrategy, setDefaultConflictStrategy] = useState(
    baseline.defaultConflictStrategy,
  );

  const isDirty =
    notificationEmail !== baseline.notificationEmail ||
    timezone !== baseline.timezone ||
    defaultConflictStrategy !== baseline.defaultConflictStrategy;

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    function handleExternalOauth(event: MessageEvent) {
      if (event.data?.source === "duplify-external-oauth" && event.data?.ok) {
        revalidator.revalidate();
      }
    }

    window.addEventListener("message", handleExternalOauth);
    return () => window.removeEventListener("message", handleExternalOauth);
  }, [revalidator]);

  function handleSave() {
    fetcher.submit(
      { notificationEmail, timezone, defaultConflictStrategy },
      { method: "post" },
    );
  }

  function handleDiscard() {
    setNotificationEmail(baseline.notificationEmail);
    setTimezone(baseline.timezone);
    setDefaultConflictStrategy(baseline.defaultConflictStrategy);
  }

  const [savedBannerDismissed, setSavedBannerDismissed] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.saved) {
      setBaseline({ notificationEmail, timezone, defaultConflictStrategy });
      setSavedBannerDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <s-page heading="Settings" inlineSize="large">
      {isDirty && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={handleSave}
          {...(isSaving ? { loading: true } : {})}
        >
          Save
        </s-button>
      )}
      {isDirty && (
        <s-button slot="secondary-actions" onClick={handleDiscard}>
          Discard
        </s-button>
      )}

      {fetcher.data?.saved && !isDirty && !savedBannerDismissed && (
        <s-banner tone="success" heading="Settings saved">
          <s-button
            slot="primary-action"
            onClick={() => setSavedBannerDismissed(true)}
          >
            Dismiss
          </s-button>
        </s-banner>
      )}

      <s-section heading="Admin API permissions">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Permission status is checked from each store's current OAuth token.
          </s-paragraph>
          {missingScopes.length === 0 ? (
            <s-banner
              tone="success"
              heading={`All ${REQUESTED_SCOPES.length} permissions granted for ${data.shopDomain}`}
            >
              This destination store is ready for scans and migrations.
            </s-banner>
          ) : (
            <s-banner tone="warning" heading="Permissions need approval">
              <s-paragraph>
                {data.shopDomain} is missing {missingScopes.length} required
                permission{missingScopes.length === 1 ? "" : "s"}.
              </s-paragraph>
              <s-button
                slot="primary-action"
                variant="primary"
                loading={isRequestingScopes}
                onClick={requestAllPermissions}
              >
                Grant all permissions
              </s-button>
            </s-banner>
          )}

          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Store</s-table-header>
              <s-table-header listSlot="labeled">Role</s-table-header>
              <s-table-header listSlot="labeled">Granted</s-table-header>
              <s-table-header listSlot="labeled">Status</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.permissionStores.map((store) => (
                <s-table-row key={store.shopDomain}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-100">
                      <s-text type="strong">{store.shopDomain}</s-text>
                      {store.isCurrent && (
                        <s-text color="subdued">Current Shopify admin</s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{store.roles.join(", ")}</s-table-cell>
                  <s-table-cell>
                    {store.grantedCount} / {store.requiredCount}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={
                        store.missingScopes.length === 0 ? "success" : "warning"
                      }
                    >
                      {store.missingScopes.length === 0
                        ? "All granted"
                        : `${store.missingScopes.length} missing`}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {!store.isCurrent && store.missingScopes.length > 0 ? (
                      <s-link
                        href={`https://admin.shopify.com/store/${store.shopDomain.replace(/\.myshopify\.com$/i, "")}/oauth/install?client_id=17baeffee1331390a337b79633f40149`}
                        target="_blank"
                      >
                        Reinstall on store
                      </s-link>
                    ) : (
                      <s-text color="subdued">-</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>

          <s-banner
            tone="warning"
            heading="Partner approval is still required before launch"
          >
            <s-paragraph>
              OAuth badges do not confirm Shopify Partner approval for protected
              customer and order data. Theme file migration also requires a
              write_themes exemption. Full order history needs approved
              read_all_orders access; without it Shopify returns only the most
              recent 60 days.
            </s-paragraph>
          </s-banner>

          <s-text type="strong">Current store scope details</s-text>
          <s-stack direction="inline" gap="small-200">
            {REQUESTED_SCOPES.map((scope) => (
              <s-badge
                key={scope}
                tone={grantedScopes.includes(scope) ? "success" : "warning"}
              >
                {scope}
              </s-badge>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Defaults">
        <s-stack direction="block" gap="base">
          <s-email-field
            name="notificationEmail"
            label="Notification email"
            details="Reserved for future migration-complete notifications."
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.currentTarget.value)}
          ></s-email-field>
          <s-select
            name="timezone"
            label="Timezone for displayed timestamps"
            value={timezone}
            onChange={(e) => setTimezone(e.currentTarget.value)}
          >
            <s-option value="" disabled>
              Select timezone
            </s-option>
            <s-option value="UTC">UTC</s-option>
            <s-option value="America/New_York">America/New_York</s-option>
            <s-option value="America/Los_Angeles">America/Los_Angeles</s-option>
            <s-option value="Europe/London">Europe/London</s-option>
            <s-option value="Asia/Kolkata">Asia/Kolkata</s-option>
          </s-select>
          <s-select
            name="defaultConflictStrategy"
            label="Default conflict handling for new migrations"
            value={defaultConflictStrategy}
            onChange={(e) => setDefaultConflictStrategy(e.currentTarget.value)}
          >
            <s-option value="" disabled>
              Select conflict handling
            </s-option>
            <s-option value="SKIP">Skip</s-option>
            <s-option value="OVERWRITE">Overwrite</s-option>
            <s-option value="CREATE_NEW">Create new copy</s-option>
            <s-option value="MERGE">Merge</s-option>
          </s-select>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Always manual">
        <s-unordered-list>
          <s-list-item>Payment gateways &amp; payouts</s-list-item>
          <s-list-item>Domains &amp; billing plan</s-list-item>
          <s-list-item>Staff accounts &amp; permissions</s-list-item>
          <s-list-item>App subscriptions</s-list-item>
          <s-list-item>
            Theme licenses (paid themes must be repurchased)
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
