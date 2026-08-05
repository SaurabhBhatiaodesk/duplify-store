import { resourceTypesForSelections, type ScanSummary } from "./scan.service";
import {
  missingReadScopes,
  missingRequestedScopes,
  missingScopes,
} from "../shopify/scopes";

export interface PermissionRequirement {
  resourceType: string;
  missing: string[];
  shopRole?: "source" | "destination";
  shopDomain?: string;
}

interface StoreScopes {
  sourceScope: string;
  destinationScope: string;
  sourceShopDomain: string;
  destinationShopDomain: string;
}

export function liveMissingPermissions(
  selectedResources: string[],
  stores: StoreScopes,
): PermissionRequirement[] {
  const resourceTypes = resourceTypesForSelections(selectedResources);

  return [
    ...resourceTypes.map((resourceType) => ({
      resourceType,
      missing: missingReadScopes(resourceType, stores.sourceScope),
      shopRole: "source" as const,
      shopDomain: stores.sourceShopDomain,
    })),
    ...resourceTypes.map((resourceType) => ({
      resourceType,
      missing: missingScopes(resourceType, stores.destinationScope),
      shopRole: "destination" as const,
      shopDomain: stores.destinationShopDomain,
    })),
  ].filter((requirement) => requirement.missing.length > 0);
}

export function liveMissingAppPermissions(
  stores: StoreScopes,
): PermissionRequirement[] {
  return [
    {
      resourceType: "app permissions",
      missing: missingRequestedScopes(stores.sourceScope),
      shopRole: "source" as const,
      shopDomain: stores.sourceShopDomain,
    },
    {
      resourceType: "app permissions",
      missing: missingRequestedScopes(stores.destinationScope),
      shopRole: "destination" as const,
      shopDomain: stores.destinationShopDomain,
    },
  ].filter((requirement) => requirement.missing.length > 0);
}

export function countLiveMissingPermissions(
  selectedResources: string[],
  stores: StoreScopes,
) {
  return new Set(
    liveMissingAppPermissions(stores).flatMap(
      (permission) => permission.missing,
    ),
  ).size;
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
  selectedResources: string[],
  stores: StoreScopes,
) {
  return (
    scanHadMissingPermissions(scanSummary) &&
    liveMissingAppPermissions(stores).length === 0
  );
}
