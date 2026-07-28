export interface LedgerReadLifecycleFields {
  readonly lifecycleState?: unknown;
  readonly deletedAt?: unknown;
}

export function isVisibleLedgerReadDocument(
  document: LedgerReadLifecycleFields
): boolean {
  return document.lifecycleState !== 'deleted'
    && document.lifecycleState !== 'superseded'
    && document.deletedAt === undefined;
}
