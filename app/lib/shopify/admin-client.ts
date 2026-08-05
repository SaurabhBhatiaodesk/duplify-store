import db from "../../db.server";
import { decryptToken } from "../crypto/token-cipher";
import {
  jitteredBackoffMs,
  recordThrottleStatus,
  sleep,
  waitForBudget,
  waitOutThrottle,
} from "./rate-limiter";

// Keep in sync with `apiVersion` in app/shopify.server.ts. Kept as a plain
// constant (rather than importing shopify.server) so the BullMQ worker
// process doesn't have to construct the full ShopifyApp object just to read
// a version string.
export const ADMIN_API_VERSION = "2026-07";

const MAX_ATTEMPTS = 5;

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    public readonly errors: unknown,
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

export interface AdminClient {
  shopDomain: string;
  graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    estimatedCost?: number,
  ): Promise<T>;
}

interface GraphqlResponseBody<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: { code?: string };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number | null;
      throttleStatus?: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

function buildClient(shopDomain: string, accessToken: string): AdminClient {
  return {
    shopDomain,
    async graphql<T>(
      query: string,
      variables?: Record<string, unknown>,
      estimatedCost = 50,
    ): Promise<T> {
      let lastError: unknown;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await waitForBudget(shopDomain, estimatedCost);

        let response: Response;
        try {
          response = await fetch(
            `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": accessToken,
              },
              body: JSON.stringify({ query, variables }),
            },
          );
        } catch (error) {
          // Network-level failure — retry with backoff.
          lastError = error;
          await sleep(jitteredBackoffMs(attempt));
          continue;
        }

        if (response.status === 429) {
          const retryAfterSeconds = Number(
            response.headers.get("Retry-After") ?? "2",
          );
          await sleep(Math.min(retryAfterSeconds * 1000, 15_000));
          continue;
        }

        if (response.status >= 500) {
          lastError = new Error(
            `Shopify Admin API returned ${response.status} for ${shopDomain}`,
          );
          await sleep(jitteredBackoffMs(attempt));
          continue;
        }

        const body = (await response.json()) as GraphqlResponseBody<T>;
        await recordThrottleStatus(shopDomain, body.extensions?.cost);

        const throttled = body.errors?.some(
          (e) => e.extensions?.code === "THROTTLED",
        );
        if (throttled) {
          const requestedCost =
            body.extensions?.cost?.requestedQueryCost ?? estimatedCost;
          await waitOutThrottle(shopDomain, requestedCost);
          continue;
        }

        if (body.errors && body.errors.length > 0) {
          throw new ShopifyGraphqlError(
            body.errors.map((e) => e.message).join("; "),
            body.errors,
          );
        }

        if (!response.ok) {
          lastError = new Error(
            `Shopify Admin API returned ${response.status} for ${shopDomain}`,
          );
          await sleep(jitteredBackoffMs(attempt));
          continue;
        }

        return body.data as T;
      }

      throw (
        lastError ??
        new Error(`Exhausted retries calling Shopify Admin API for ${shopDomain}`)
      );
    },
  };
}

export function createAdminClient(shop: {
  shopDomain: string;
  accessTokenEncrypted: string;
}): AdminClient {
  return buildClient(shop.shopDomain, decryptToken(shop.accessTokenEncrypted));
}

export async function createAdminClientForShopId(
  shopId: string,
): Promise<AdminClient> {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  return createAdminClient(shop);
}
