import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { syncEmbeddedShopFromSession } from "../lib/services/storeConnection.service";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Keep Shop.scope / token in sync on every open — otherwise Overview keeps
  // saying "Source store needs Duplify installed" after the app is already on.
  await syncEmbeddedShopFromSession(session);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopDomain: session.shop,
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/connect">Import / Export</s-link>
        <s-link href="/app/migrations">History</s-link>
        <s-link href="/app/mappings">ID mappings</s-link>
        <s-link href="/app/documentation">Documentation</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

function FriendlyError({ message }: { message: string }) {
  return (
    <s-page heading="Something went wrong">
      <s-banner tone="critical" heading="Could not load this page">
        <s-paragraph>{message}</s-paragraph>
        <s-button slot="primary-action" href="/app" variant="primary">
          Back to Overview
        </s-button>
      </s-banner>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their
// headers are included. Shopify's default boundary rethrows normal Errors and
// can render an empty pink banner for ErrorResponses with blank bodies.
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.data && typeof error.data === "string" && error.data.trim()) {
      return boundary.error(error);
    }
    return (
      <FriendlyError
        message={
          error.statusText ||
          `Request failed (${error.status}). Try refreshing the page.`
        }
      />
    );
  }

  if (error instanceof Error) {
    return (
      <FriendlyError
        message={error.message || "Unexpected client error. Please refresh."}
      />
    );
  }

  try {
    return boundary.error(error);
  } catch {
    return (
      <FriendlyError message="Unexpected error. Please refresh the page." />
    );
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  const headers = boundary.headers(headersArgs);
  headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  headers.set("Pragma", "no-cache");
  return headers;
};
