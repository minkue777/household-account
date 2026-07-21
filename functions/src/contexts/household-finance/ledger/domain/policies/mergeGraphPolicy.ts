import type {
  MergeLeafSnapshot,
  MergeTransaction,
} from "../model/mergeIntegrity";

export function hasMergeAncestryCycle(
  roots: readonly MergeTransaction[],
  all: readonly MergeTransaction[],
): boolean {
  const byId = new Map(all.map((transaction) => [transaction.transactionId, transaction]));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(transactionId: string): boolean {
    if (visiting.has(transactionId)) return true;
    if (visited.has(transactionId)) return false;
    const transaction = byId.get(transactionId);
    if (transaction === undefined) return false;
    visiting.add(transactionId);
    for (const parentId of transaction.mergeParentIds ?? []) {
      if (visit(parentId)) return true;
    }
    visiting.delete(transactionId);
    visited.add(transactionId);
    return false;
  }

  return roots.some((root) => visit(root.transactionId));
}

function leafOf(transaction: MergeTransaction): MergeLeafSnapshot {
  return {
    transactionId: transaction.transactionId,
    merchant: transaction.merchant,
    amountInWon: transaction.amountInWon,
    categoryId: transaction.categoryId,
    memo: transaction.memo,
    source: transaction.source,
    originChannel: transaction.originChannel,
    creatorMemberId: transaction.creatorMemberId,
    captureLineageId: transaction.captureLineageId,
  };
}

export type FlattenMergeLeavesResult =
  | { kind: "success"; leaves: readonly MergeLeafSnapshot[] }
  | { kind: "overlap" }
  | { kind: "incomplete" };

export function flattenMergeLeaves(
  transactions: readonly MergeTransaction[],
): FlattenMergeLeavesResult {
  const leaves: MergeLeafSnapshot[] = [];
  const leafIds = new Set<string>();
  for (const transaction of transactions) {
    const nested = (transaction.mergeParentIds?.length ?? 0) > 0;
    if (nested && transaction.mergeSnapshot === undefined) {
      return { kind: "incomplete" };
    }
    const candidates = nested ? transaction.mergeSnapshot ?? [] : [leafOf(transaction)];
    for (const leaf of candidates) {
      if (leafIds.has(leaf.transactionId)) return { kind: "overlap" };
      leafIds.add(leaf.transactionId);
      leaves.push({ ...leaf });
    }
  }
  return { kind: "success", leaves };
}
