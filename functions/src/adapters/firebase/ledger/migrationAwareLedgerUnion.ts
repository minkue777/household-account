export function mergeCanonicalLedgerTransactions<
  T extends { readonly transactionId: string },
>(input: {
  readonly canonical: readonly T[];
  readonly legacy: readonly T[];
}): readonly T[] {
  const byId = new Map<string, T>();
  for (const transaction of input.legacy) {
    byId.set(transaction.transactionId, transaction);
  }
  for (const transaction of input.canonical) {
    byId.set(transaction.transactionId, transaction);
  }
  return [...byId.values()];
}
