import { resourceTypesForSelections, type ScanSummary } from "./scan.service";
import {
  missingReadScopes,
  missingScopes,
  shopCanMigrate,
  shopIsConnected,
} from "../shopify/scopes";

export interface PermissionRequirement {
  resourceType: string;
  missing: string[];
  shopRole?: "source" | "destination";
  shopDomain?: string;
  /** false = app not connected on that shop (reconnect), not a scopes.request loop */
  installed?: boolean;
}

interface StoreScopes {
  sourceScope: string;
  destinationScope: string;
  sourceShopDomain: string;
  destinationShopDomain: string;
  sourceConnected?: boolean;
  destinationConnected?: boolean;
}

/**
 * Install already requests the full published scope set. Connected shops must
 * not see "Store update needed" / Grant permissions spam by default.
 * Only disconnected shops (no offline token) need a reconnect action.
 */
export function liveMissingPermissions(
  selectedResources: string[],
  stores: StoreScopes,
): PermissionRequirement[] {
  const resourceTypes = resourceTypesForSelections(selectedResources);
  const sourceReady =
    stores.sourceConnected === true || shopCanMigrate(stores.sourceScope);
  const destinationReady =
    stores.destinationConnected === true ||
    shopCanMigrate(stores.destinationScope);

  return [
    ...resourceTypes.map((resourceType) => ({
      resourceType,
      missing: sourceReady
        ? []
        : missingReadScopes(resourceType, stores.sourceScope),
      shopRole: "source" as const,
      shopDomain: stores.sourceShopDomain,
      installed: stores.sourceConnected !== false,
    })),
    ...resourceTypes.map((resourceType) => ({
      resourceType,
      missing: destinationReady
        ? []
        : missingScopes(resourceType, stores.destinationScope),
      shopRole: "destination" as const,
      shopDomain: stores.destinationShopDomain,
      installed: stores.destinationConnected !== false,
    })),
  ].filter((requirement) => requirement.missing.length > 0);
}

export function liveMissingAppPermissions(
  stores: StoreScopes,
): PermissionRequirement[] {
  const sourceConnected = stores.sourceConnected === true;
  const destinationConnected = stores.destinationConnected === true;

  // Connected = access by default. Never invent a missing-scope grant loop.
  const requirements: PermissionRequirement[] = [];

  if (!sourceConnected && !shopCanMigrate(stores.sourceScope)) {
    requirements.push({
      resourceType: "app permissions",
      // One clear reconnect signal — not 20 fake missing scopes.
      missing: ["reconnect"],
      shopRole: "source",
      shopDomain: stores.sourceShopDomain,
      installed: false,
    });
  }

  if (!destinationConnected && !shopCanMigrate(stores.destinationScope)) {
    requirements.push({
      resourceType: "app permissions",
      missing: ["reconnect"],
      shopRole: "destination",
      shopDomain: stores.destinationShopDomain,
      installed: false,
    });
  }

  return requirements;
}

export function countLiveMissingPermissions(
  selectedResources: string[],
  stores: StoreScopes,
) {
  return liveMissingAppPermissions(stores).length;
}

export function scanHadMissingPermissions(scanSummary: ScanSummary | null) {
  return (
    scanSummary?.requiredPermissions.some(
      (permission) => permission.missing.length > 0,
    ) ?? false
  );
}

export function needsPermissionRescan(
  scanSummary: ScanSummary | null,
  _selectedResources: string[],
  stores: StoreScopes,
) {
  return (
    scanHadMissingPermissions(scanSummary) &&
    liveMissingAppPermissions(stores).length === 0
  );
}

export function storeScopesFromConnection(connection: {
  sourceShop: {
    shopDomain: string;
    scope: string;
    isActive: boolean;
    accessTokenEncrypted: string | null;
    uninstalledAt: Date | null;
  };
  destinationShop: {
    shopDomain: string;
    scope: string;
    isActive: boolean;
    accessTokenEncrypted: string | null;
    uninstalledAt: Date | null;
  };
}): StoreScopes {
  return {
    sourceScope: connection.sourceShop.scope,
    destinationScope: connection.destinationShop.scope,
    sourceShopDomain: connection.sourceShop.shopDomain,
    destinationShopDomain: connection.destinationShop.shopDomain,
    sourceConnected: shopIsConnected(connection.sourceShop),
    destinationConnected: shopIsConnected(connection.destinationShop),
  };
}
