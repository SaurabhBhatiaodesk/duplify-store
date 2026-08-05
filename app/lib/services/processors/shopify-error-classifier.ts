export function isReservedDefinitionError(message: string): boolean {
  return /reserved for use by another application/i.test(message);
}

export function isInvalidRemoteFileError(message: string): boolean {
  return /invalid .*url|url is invalid|source.*invalid/i.test(message);
}

export function shouldSkipDefinitionCreateError(message: string): boolean {
  return /already exists|taken/i.test(message) || isReservedDefinitionError(message);
}

export function skippedDefinitionMessage(message: string): string {
  if (isReservedDefinitionError(message)) {
    return "Definition is app-reserved on Shopify and cannot be recreated by this app";
  }
  return "Definition already exists on destination store";
}
