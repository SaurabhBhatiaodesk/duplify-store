import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listConnectionsForOwner } from "../lib/services/storeConnection.service";
import { MappingsTable } from "../components/mappings/MappingsTable";
import { EmptyState } from "../components/shared/EmptyState";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUniqueOrThrow({ where: { shopDomain: session.shop } });

  const connections = await listConnectionsForOwner(shop.id);
  const connectionIds = connections.map((c) => c.id);

  const url = new URL(request.url);
  const resourceType = url.searchParams.get("resourceType") || undefined;
  const connectionId = url.searchParams.get("connectionId") || undefined;
  const search = url.searchParams.get("q") || undefined;

  const rows = await db.idMapping.findMany({
    where: {
      storeConnectionId: connectionId ?? { in: connectionIds },
      resourceType,
      OR: search
        ? [
            { sourceHandle: { contains: search, mode: "insensitive" } },
            { destinationHandle: { contains: search, mode: "insensitive" } },
          ]
        : undefined,
    },
    orderBy: { updatedAt: "desc" },
    take: 250,
  });

  return {
    connections: connections.map((c) => ({
      id: c.id,
      label: `${c.sourceShop.shopDomain} → ${c.destinationShop.shopDomain}`,
    })),
    rows: rows.map((r) => ({
      id: r.id,
      resourceType: r.resourceType,
      sourceId: r.sourceId,
      destinationId: r.destinationId,
      sourceHandle: r.sourceHandle,
      destinationHandle: r.destinationHandle,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
};

export default function IdMappings() {
  const { connections, rows } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  if (connections.length === 0) {
    return (
      <s-page heading="ID mappings" inlineSize="large">
        <s-section>
          <EmptyState
            heading="No store pairs yet"
            message="ID mappings appear here once you've connected stores and run a migration."
            action={{ label: "Connect stores", href: "/app/connect" }}
          />
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="ID mappings" inlineSize="large">
      <s-section heading="Filters">
        <Form method="get">
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 240px", minWidth: "200px" }}>
              <s-search-field name="q" label="Search by handle" value={searchParams.get("q") ?? ""}></s-search-field>
            </div>
            <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
              <s-select name="resourceType" label="Resource type" value={searchParams.get("resourceType") ?? ""}>
                <s-option value="">Any resource</s-option>
                <s-option value="product">Product</s-option>
                <s-option value="variant">Variant</s-option>
                <s-option value="image">Image</s-option>
                <s-option value="collection">Collection</s-option>
                <s-option value="customer">Customer</s-option>
                <s-option value="page">Page</s-option>
                <s-option value="blog">Blog</s-option>
                <s-option value="article">Article</s-option>
                <s-option value="file">File</s-option>
                <s-option value="menu">Menu</s-option>
                <s-option value="metafield_definition">Metafield definition</s-option>
                <s-option value="metaobject_definition">Metaobject definition</s-option>
                <s-option value="metaobject">Metaobject</s-option>
                <s-option value="discount">Discount</s-option>
                <s-option value="order">Order</s-option>
                <s-option value="theme">Theme</s-option>
              </s-select>
            </div>
            <div style={{ flex: "1 1 220px", minWidth: "200px" }}>
              <s-select name="connectionId" label="Store pair" value={searchParams.get("connectionId") ?? ""}>
                <s-option value="">All store pairs</s-option>
                {connections.map((c) => (
                  <s-option key={c.id} value={c.id}>
                    {c.label}
                  </s-option>
                ))}
              </s-select>
            </div>
            <s-button type="submit">Apply</s-button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Mappings">
        <MappingsTable rows={rows} />
      </s-section>
    </s-page>
  );
}
