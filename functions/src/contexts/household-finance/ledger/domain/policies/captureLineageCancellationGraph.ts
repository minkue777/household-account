export interface CaptureLineageCancellationNode {
  readonly transactionId: string;
  readonly lifecycleState: "active" | "superseded" | "deleted";
  readonly captureLineageIds: readonly string[];
  readonly parentTransactionIds: readonly string[];
  readonly mergeLeafIds: readonly string[];
}

export interface CaptureLineageCancellationPlan {
  readonly affectedTransactionIds: readonly string[];
  readonly restorableLeafIds: readonly string[];
  readonly invalidGraph: boolean;
}

export function planCaptureLineageCancellation(input: {
  readonly captureLineageId: string;
  readonly transactions: readonly CaptureLineageCancellationNode[];
}): CaptureLineageCancellationPlan {
  const byId = new Map(
    input.transactions.map((transaction) => [
      transaction.transactionId,
      transaction,
    ]),
  );
  const affected = new Set(
    input.transactions
      .filter((transaction) =>
        transaction.captureLineageIds.includes(input.captureLineageId),
      )
      .map((transaction) => transaction.transactionId),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const transaction of input.transactions) {
      if (affected.has(transaction.transactionId)) continue;
      if (
        [...transaction.parentTransactionIds, ...transaction.mergeLeafIds].some(
          (parentId) => affected.has(parentId),
        )
      ) {
        affected.add(transaction.transactionId);
        changed = true;
      }
    }
  }

  const restorable = new Set<string>();
  let invalidGraph = false;
  for (const transactionId of affected) {
    const transaction = byId.get(transactionId);
    if (
      transaction === undefined ||
      transaction.lifecycleState !== "active"
    ) {
      continue;
    }
    if (
      new Set(transaction.mergeLeafIds).size !==
        transaction.mergeLeafIds.length ||
      transaction.mergeLeafIds.includes(transaction.transactionId)
    ) {
      invalidGraph = true;
    }
    for (const leafId of transaction.mergeLeafIds) {
      const leaf = byId.get(leafId);
      if (leaf !== undefined && leaf.mergeLeafIds.length > 0) {
        invalidGraph = true;
      }
      if (
        !affected.has(leafId) &&
        (leaf === undefined || leaf.mergeLeafIds.length === 0)
      ) {
        restorable.add(leafId);
      }
    }
  }

  return {
    affectedTransactionIds: [...affected],
    restorableLeafIds: [...restorable],
    invalidGraph,
  };
}
