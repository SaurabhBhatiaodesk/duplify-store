// Central registry of which Shopify Admin API scopes each migration resource
// type needs, tagged by the phase that ships it. Used by shopify.server.ts to
// build the requested scope list and by scan.service.ts to warn the merchant
// about missing permissions during the pre-migration scan.

export const PHASE_1_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
] as const;

export const PHASE_2_SCOPES = [
  "read_customers",
  "write_customers",
  "read_content",
  "write_content",
  "read_files",
  "write_files",
  "read_metaobjects",
  "write_metaobjects",
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_online_store_navigation",
  "write_online_store_navigation",
] as const;

export const PHASE_3_SCOPES = [
  "read_discounts",
  "write_discounts",
  "read_orders",
  "read_all_orders",
  "write_orders",
  "read_draft_orders",
  "write_draft_orders",
  "read_themes",
  "write_themes",
] as const;

// All phases are now requested — Phase 1/2/3 resource types all ship in this
// build. Bumping this list re-triggers Shopify's scope-consent screen for
// already-installed shops (handled by the app/scopes_update webhook).
export const REQUESTED_SCOPES = [
  ...PHASE_1_SCOPES,
  ...PHASE_2_SCOPES,
  ...PHASE_3_SCOPES,
];

export const RESOURCE_TYPE_SCOPES: Record<string, readonly string[]> = {
  product: ["read_products", "write_products"],
  variant: ["read_products", "write_products"],
  image: ["read_products", "write_products"],
  inventory: [
    "read_products",
    "read_inventory",
    "write_inventory",
    "read_locations",
  ],
  collection: ["read_products", "write_products"],
  customer: ["read_customers", "write_customers"],
  page: ["read_content", "write_content"],
  blog: ["read_content", "write_content"],
  article: ["read_content", "write_content"],
  file: ["read_files", "write_files"],
  metafield_definition: [
    "read_products",
    "write_products",
    "read_customers",
    "write_customers",
    "read_content",
    "write_content",
    "read_orders",
    "write_orders",
  ],
  metaobject_definition: [
    "read_metaobject_definitions",
    "write_metaobject_definitions",
  ],
  metaobject: ["read_metaobjects", "write_metaobjects"],
  menu: ["read_online_store_navigation", "write_online_store_navigation"],
  discount: ["read_discounts", "write_discounts"],
  order: [
    "read_orders",
    "read_all_orders",
    "read_draft_orders",
    "write_draft_orders",
  ],
  theme: ["read_themes", "write_themes"],
};

export function parseGrantedScopes(grantedScope: string): Set<string> {
  const granted = new Set(
    grantedScope
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );

  // Shopify may return write_* without the matching read_*. For our access
  // checks, write access is enough to cover the matching read scope.
  for (const scope of [...granted]) {
    if (scope.startsWith("write_")) {
      granted.add(`read_${scope.slice("write_".length)}`);
    }
  }

  return granted;
}

export function missingRequestedScopes(grantedScope: string): string[] {
  const granted = parseGrantedScopes(grantedScope);
  return REQUESTED_SCOPES.filter((scope) => !granted.has(scope));
}

export function missingScopes(
  resourceType: string,
  grantedScope: string,
): string[] {
  const granted = parseGrantedScopes(grantedScope);
  const required = RESOURCE_TYPE_SCOPES[resourceType] ?? [];
  return required.filter((scope) => !granted.has(scope));
}

export function missingReadScopes(
  resourceType: string,
  grantedScope: string,
): string[] {
  const granted = parseGrantedScopes(grantedScope);
  const required = RESOURCE_TYPE_SCOPES[resourceType] ?? [];
  return required.filter(
    (scope) => scope.startsWith("read_") && !granted.has(scope),
  );
}
