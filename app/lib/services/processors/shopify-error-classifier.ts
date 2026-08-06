export function isReservedDefinitionError(message: string): boolean {
  return /reserved for use by another application/i.test(message);
}

export function isAccessDeniedDefinitionError(message: string): boolean {
  return (
    /access denied for metafielddefinitioncreate/i.test(message) ||
    /api client to have access to the namespace/i.test(message)
  );
}

export function isDefinitionInUseError(message: string): boolean {
  return (
    /already exists|taken|key is in use/i.test(message) ||
    /in use for .+ metafields/i.test(message)
  );
}

export function isInvalidRemoteFileError(message: string): boolean {
  return /invalid .*url|url is invalid|source.*invalid/i.test(message);
}

export function shouldSkipDefinitionCreateError(message: string): boolean {
  return (
    isDefinitionInUseError(message) ||
    isReservedDefinitionError(message) ||
    isAccessDeniedDefinitionError(message) ||
    /validations require that you select a metaobject/i.test(message)
  );
}

export function skippedDefinitionMessage(message: string): string {
  if (isReservedDefinitionError(message) || isAccessDeniedDefinitionError(message)) {
    return "Definition is owned/protected by Shopify or another app and cannot be recreated by Duplify";
  }
  if (/validations require that you select a metaobject/i.test(message)) {
    return "Definition needs a metaobject that is not available on the destination store";
  }
  return "Definition already exists on destination store";
}
