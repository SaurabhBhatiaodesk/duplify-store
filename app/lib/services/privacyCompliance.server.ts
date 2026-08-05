import db from "../../db.server";

interface CustomerPrivacyPayload {
  customer?: {
    id?: number | string;
    email?: string | null;
  };
  orders_to_redact?: Array<number | string>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function gid(resource: "Customer" | "Order", id: number | string) {
  return `gid://shopify/${resource}/${String(id)}`;
}

async function connectionAndJobIds(shopId: string) {
  const connections = await db.storeConnection.findMany({
    where: {
      OR: [
        { ownerShopId: shopId },
        { sourceShopId: shopId },
        { destinationShopId: shopId },
      ],
    },
    select: { id: true },
  });
  const connectionIds = connections.map((connection) => connection.id);
  const jobs = await db.migrationJob.findMany({
    where: { storeConnectionId: { in: connectionIds } },
    select: { id: true },
  });

  return {
    connectionIds,
    jobIds: jobs.map((job) => job.id),
  };
}

export async function recordCustomerDataRequest(
  shopDomain: string,
  topic: string,
  payload: unknown,
) {
  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) return;

  await db.webhookEvent.create({
    data: {
      shopId: shop.id,
      topic,
      payload: payload as object,
      processedAt: null,
    },
  });
}

export async function redactCustomerData(
  shopDomain: string,
  payload: CustomerPrivacyPayload,
) {
  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop || payload.customer?.id === undefined) return;

  const { connectionIds, jobIds } = await connectionAndJobIds(shop.id);
  const customerGid = gid("Customer", payload.customer.id);
  const orderGids = (payload.orders_to_redact ?? []).map((id) =>
    gid("Order", id),
  );
  const customerEmail = payload.customer.email?.trim().toLowerCase() ?? null;

  const candidateItems = await db.migrationItem.findMany({
    where: {
      migrationJobId: { in: jobIds },
      resourceType: { in: ["customer", "order"] },
    },
    select: {
      id: true,
      resourceType: true,
      sourceId: true,
      payload: true,
    },
  });

  const itemIds = candidateItems
    .filter((item) => {
      if (item.resourceType === "customer") {
        return item.sourceId === customerGid;
      }

      const stored = asRecord(item.payload);
      const storedEmail =
        typeof stored.email === "string" ? stored.email.toLowerCase() : null;
      return (
        orderGids.includes(item.sourceId) ||
        stored.customerSourceId === customerGid ||
        (customerEmail !== null && storedEmail === customerEmail)
      );
    })
    .map((item) => item.id);

  await db.$transaction([
    db.migrationItem.deleteMany({ where: { id: { in: itemIds } } }),
    db.idMapping.deleteMany({
      where: {
        storeConnectionId: { in: connectionIds },
        OR: [
          { sourceId: customerGid },
          { destinationId: customerGid },
          { sourceId: { in: orderGids } },
          { destinationId: { in: orderGids } },
        ],
      },
    }),
    db.conflict.deleteMany({
      where: {
        storeConnectionId: { in: connectionIds },
        OR: [{ sourceId: customerGid }, { matchedDestinationId: customerGid }],
      },
    }),
    ...(customerEmail
      ? [
          db.migrationLog.deleteMany({
            where: {
              migrationJobId: { in: jobIds },
              message: { contains: customerEmail, mode: "insensitive" },
            },
          }),
        ]
      : []),
    db.webhookEvent.deleteMany({
      where: {
        shopId: shop.id,
        topic: {
          in: ["CUSTOMERS_DATA_REQUEST", "customers/data_request"],
        },
      },
    }),
  ]);
}

export async function redactShopData(shopDomain: string) {
  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    await db.session.deleteMany({ where: { shop: shopDomain } });
    return;
  }

  const { connectionIds, jobIds } = await connectionAndJobIds(shop.id);

  await db.$transaction([
    db.conflict.deleteMany({
      where: { storeConnectionId: { in: connectionIds } },
    }),
    db.migrationLog.deleteMany({
      where: { migrationJobId: { in: jobIds } },
    }),
    db.migrationItem.deleteMany({
      where: { migrationJobId: { in: jobIds } },
    }),
    db.migrationJob.deleteMany({ where: { id: { in: jobIds } } }),
    db.idMapping.deleteMany({
      where: { storeConnectionId: { in: connectionIds } },
    }),
    db.storeConnection.deleteMany({ where: { id: { in: connectionIds } } }),
    db.appSetting.deleteMany({ where: { shopId: shop.id } }),
    db.webhookEvent.deleteMany({ where: { shopId: shop.id } }),
    db.session.deleteMany({ where: { shop: shopDomain } }),
    db.shop.delete({ where: { id: shop.id } }),
  ]);
}
