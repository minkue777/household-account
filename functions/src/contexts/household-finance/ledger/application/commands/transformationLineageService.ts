import type {
  TransformationLineageClock,
  TransformationLineageSelection,
  TransformationLineageStore,
} from "../ports/transformationLineageStore";
import type {
  LedgerTransformationResult,
  LedgerTransformationState,
  LedgerTransformationTransaction,
} from "../../domain/model/transformationLineage";
import { planCaptureLineageCancellation } from "../../domain/policies/captureLineageCancellationGraph";
import { areLocalCurrencyTypesCompatible } from "../../domain/policies/localCurrencyTypeCompatibility";

export interface LedgerTransformationCommands {
  splitItems(command: {
    operationKey: string;
    sourceId: string;
    expectedVersion: number;
    items: readonly {
      amountInWon: number;
      merchant: string;
      categoryId: string;
      memo: string;
    }[];
  }): Promise<LedgerTransformationResult>;
  merge(command: {
    operationKey: string;
    targetId: string;
    sourceIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<LedgerTransformationResult>;
  unmerge(command: {
    operationKey: string;
    mergedTransactionId: string;
    expectedVersion: number;
  }): Promise<LedgerTransformationResult>;
  update(command: {
    operationKey: string;
    transactionId: string;
    expectedVersion: number;
    amountInWon: number;
  }): Promise<LedgerTransformationResult>;
  cancelCapturedLineage(command: {
    cancellationKey: string;
    captureLineageId: string;
    expectedLineageVersion: number;
  }): Promise<LedgerTransformationResult>;
}

function copyTransaction(
  transaction: LedgerTransformationTransaction,
): LedgerTransformationTransaction {
  return {
    ...transaction,
    provenance: { ...transaction.provenance },
    ...(transaction.mergeLeafIds === undefined
      ? {}
      : { mergeLeafIds: [...transaction.mergeLeafIds] }),
    ...(transaction.intermediateMergeHistoryIds === undefined
      ? {}
      : {
          intermediateMergeHistoryIds: [
            ...transaction.intermediateMergeHistoryIds,
          ],
        }),
  };
}

function replaceTransactions(
  state: LedgerTransformationState,
  transactions: readonly LedgerTransformationTransaction[],
): LedgerTransformationState {
  return {
    transactions: transactions.map(copyTransaction),
    dedupClaims: state.dedupClaims.map((claim) => ({ ...claim })),
    cancelledLineages: state.cancelledLineages.map((entry) => ({ ...entry })),
  };
}

function mergeStates(
  ...states: readonly LedgerTransformationState[]
): LedgerTransformationState {
  const transactions = new Map<string, LedgerTransformationTransaction>();
  const dedupClaims = new Map<string, LedgerTransformationState["dedupClaims"][number]>();
  const cancelledLineages = new Map<
    string,
    LedgerTransformationState["cancelledLineages"][number]
  >();
  for (const state of states) {
    state.transactions.forEach((transaction) => {
      transactions.set(transaction.transactionId, copyTransaction(transaction));
    });
    state.dedupClaims.forEach((claim) => {
      dedupClaims.set(claim.captureLineageId, { ...claim });
    });
    state.cancelledLineages.forEach((entry) => {
      cancelledLineages.set(entry.captureLineageId, { ...entry });
    });
  }
  return {
    transactions: [...transactions.values()],
    dedupClaims: [...dedupClaims.values()],
    cancelledLineages: [...cancelledLineages.values()],
  };
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function expectedFor(
  transactions: readonly LedgerTransformationTransaction[],
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    transactions.map((transaction) => [
      transaction.transactionId,
      transaction.aggregateVersion,
    ]),
  );
}

export function createLedgerTransformationCommands(input: {
  store: TransformationLineageStore;
  clock: TransformationLineageClock;
}): LedgerTransformationCommands {
  async function loadTransactions(
    transactionIds: readonly string[],
  ): Promise<LedgerTransformationState> {
    return input.store.load({ transactionIds: distinct(transactionIds) });
  }

  async function includeTransactions(
    state: LedgerTransformationState,
    transactionIds: readonly string[],
  ): Promise<LedgerTransformationState> {
    const loaded = new Set(
      state.transactions.map((transaction) => transaction.transactionId),
    );
    const missing = distinct(transactionIds).filter((id) => !loaded.has(id));
    return missing.length === 0
      ? state
      : mergeStates(state, await loadTransactions(missing));
  }

  async function commit(
    operationKey: string,
    expectedVersions: Readonly<Record<string, number>>,
    selection: TransformationLineageSelection,
    baseline: LedgerTransformationState,
    state: LedgerTransformationState,
    transactionIds: readonly string[],
    transactions?: readonly LedgerTransformationTransaction[],
    requireCompleteMergeLineage = false,
  ): Promise<LedgerTransformationResult> {
    const result = {
      kind: "success" as const,
      transactionIds,
      ...(transactions === undefined
        ? {}
        : { transactions: transactions.map(copyTransaction) }),
    };
    const committed = await input.store.commit({
      operationKey,
      expectedVersions,
      selection,
      baseline,
      state,
      result,
      ...(requireCompleteMergeLineage
        ? { requireCompleteMergeLineage: true }
        : {}),
    });
    return committed.kind === "success" ? result : committed;
  }

  return {
    splitItems: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const selection = { transactionIds: [command.sourceId] };
      const state = await input.store.load(selection);
      const source = state.transactions.find(
        (transaction) =>
          transaction.transactionId === command.sourceId &&
          transaction.lifecycleState === "active",
      );
      if (source === undefined || source.aggregateVersion !== command.expectedVersion) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      if (
        command.items.length < 2 ||
        command.items.some(
          (item) =>
            !Number.isSafeInteger(item.amountInWon) || item.amountInWon <= 0,
        ) ||
        command.items.reduce((sum, item) => sum + item.amountInWon, 0) !==
          source.amountInWon
      ) {
        return { kind: "contract-failure", code: "INVALID_ITEM_SPLIT" };
      }
      const superseded: LedgerTransformationTransaction = {
        ...copyTransaction(source),
        lifecycleState: "superseded",
        aggregateVersion: source.aggregateVersion + 1,
      };
      const derived = command.items.map<LedgerTransformationTransaction>(
        (item, index) => ({
          ...copyTransaction(source),
          transactionId: `${source.transactionId}:item:${index + 1}:${command.operationKey}`,
          lifecycleState: "active",
          amountInWon: item.amountInWon,
          merchant: item.merchant,
          categoryId: item.categoryId,
          memo: item.memo,
          aggregateVersion: 1,
          provenance: { ...source.provenance },
        }),
      );
      const transactions = state.transactions.map((transaction) =>
        transaction.transactionId === source.transactionId
          ? superseded
          : copyTransaction(transaction),
      );
      transactions.push(...derived);
      return commit(
        command.operationKey,
        { [source.transactionId]: command.expectedVersion },
        selection,
        state,
        replaceTransactions(state, transactions),
        derived.map((transaction) => transaction.transactionId),
      );
    },

    update: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const selection = { transactionIds: [command.transactionId] };
      const state = await input.store.load(selection);
      const current = state.transactions.find(
        (transaction) =>
          transaction.transactionId === command.transactionId &&
          transaction.lifecycleState === "active",
      );
      if (
        current === undefined ||
        current.aggregateVersion !== command.expectedVersion
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      const changed: LedgerTransformationTransaction = {
        ...copyTransaction(current),
        amountInWon: command.amountInWon,
        aggregateVersion: current.aggregateVersion + 1,
      };
      return commit(
        command.operationKey,
        { [current.transactionId]: command.expectedVersion },
        selection,
        state,
        replaceTransactions(
          state,
          state.transactions.map((transaction) =>
            transaction.transactionId === current.transactionId
              ? changed
              : copyTransaction(transaction),
          ),
        ),
        [changed.transactionId],
      );
    },

    merge: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      const selectedIds = [command.targetId, ...command.sourceIds];
      let state = await loadTransactions(selectedIds);
      const selected = selectedIds.map((transactionId) =>
        state.transactions.find(
          (transaction) =>
            transaction.transactionId === transactionId &&
            transaction.lifecycleState === "active",
        ),
      );
      if (
        selected.some((transaction) => transaction === undefined) ||
        selected.some(
          (transaction) =>
            transaction !== undefined &&
            command.expectedVersions[transaction.transactionId] !==
              transaction.aggregateVersion,
        )
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      const aggregates = selected as readonly LedgerTransformationTransaction[];
      if (
        aggregates.some(
          (transaction) =>
            transaction.legacyMergeSnapshotPresent === true &&
            transaction.mergeLeafIds === undefined,
        )
      ) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      if (
        aggregates.some(
          (transaction) => transaction.transactionType !== "expense",
        )
      ) {
        return { kind: "conflict", code: "MERGE_EXPENSE_ONLY" };
      }
      if (
        !areLocalCurrencyTypesCompatible(
          aggregates.map(
            (transaction) => transaction.provenance.localCurrencyType,
          ),
        )
      ) {
        return { kind: "conflict", code: "LOCAL_CURRENCY_TYPE_MISMATCH" };
      }
      const leafIds = aggregates.flatMap(
        (transaction) => transaction.mergeLeafIds ?? [transaction.transactionId],
      );
      const selectedMergeIds = new Set(
        aggregates
          .filter((transaction) => transaction.mergeLeafIds !== undefined)
          .map((transaction) => transaction.transactionId),
      );
      if (leafIds.some((leafId) => selectedMergeIds.has(leafId))) {
        return { kind: "conflict", code: "MERGE_ANCESTRY_CYCLE" };
      }
      if (new Set(leafIds).size !== leafIds.length) {
        return { kind: "conflict", code: "MERGE_LEAF_OVERLAP" };
      }
      state = await includeTransactions(state, leafIds);
      const leaves = leafIds.map((leafId) =>
        state.transactions.find(
          (transaction) => transaction.transactionId === leafId,
        ),
      );
      if (leaves.some((leaf) => leaf === undefined)) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      if (
        leaves.some(
          (leaf) =>
            leaf !== undefined && leaf.mergeLeafIds !== undefined,
        )
      ) {
        return { kind: "conflict", code: "MERGE_ANCESTRY_CYCLE" };
      }
      const target = aggregates[0];
      const intermediateMergeHistoryIds = aggregates.flatMap((transaction) => [
        ...(transaction.mergeLeafIds === undefined
          ? []
          : [transaction.transactionId]),
        ...(transaction.intermediateMergeHistoryIds ?? []),
      ]);
      const mergedId = `merged:${command.operationKey}`;
      const selection = {
        transactionIds: distinct([...selectedIds, ...leafIds]),
      };
      const merged: LedgerTransformationTransaction = {
        ...copyTransaction(target),
        transactionId: mergedId,
        lifecycleState: "active",
        amountInWon: aggregates.reduce(
          (sum, transaction) => sum + transaction.amountInWon,
          0,
        ),
        aggregateVersion: 1,
        mergeLeafIds: [...leafIds],
        intermediateMergeHistoryIds,
      };
      const selectedSet = new Set(selectedIds);
      const next = state.transactions.map((transaction) =>
        selectedSet.has(transaction.transactionId)
          ? {
              ...copyTransaction(transaction),
              lifecycleState: "superseded" as const,
              aggregateVersion: transaction.aggregateVersion + 1,
            }
          : copyTransaction(transaction),
      );
      next.push(merged);
      return commit(
        command.operationKey,
        command.expectedVersions,
        selection,
        state,
        replaceTransactions(state, next),
        [mergedId],
        [merged],
      );
    },

    unmerge: async (command) => {
      const replay = await input.store.findReceipt(command.operationKey);
      if (replay !== undefined) return replay;
      let state = await loadTransactions([command.mergedTransactionId]);
      const merged = state.transactions.find(
        (transaction) =>
          transaction.transactionId === command.mergedTransactionId &&
          transaction.lifecycleState === "active",
      );
      if (
        merged === undefined ||
        merged.aggregateVersion !== command.expectedVersion
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }
      const leafIds = merged.mergeLeafIds;
      if (
        leafIds === undefined ||
        leafIds.length === 0 ||
        new Set(leafIds).size !== leafIds.length
      ) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      state = await includeTransactions(state, leafIds);
      const leafSet = new Set(leafIds);
      const leaves = state.transactions.filter((transaction) =>
        leafSet.has(transaction.transactionId),
      );
      if (leaves.length !== leafSet.size) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      if (
        leaves.some(
          (leaf) =>
            leaf.mergeLeafIds !== undefined ||
            leaf.legacyMergeSnapshotPresent === true,
        )
      ) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      const next = state.transactions.map((transaction) => {
        if (leafSet.has(transaction.transactionId)) {
          return {
            ...copyTransaction(transaction),
            lifecycleState: "active" as const,
            accountingDate: merged.accountingDate,
            localTime: merged.localTime,
            transactionType: merged.transactionType,
            cardType: merged.cardType,
            cardDisplay: merged.cardDisplay,
            aggregateVersion: transaction.aggregateVersion + 1,
          };
        }
        if (transaction.transactionId === merged.transactionId) {
          return {
            ...copyTransaction(transaction),
            lifecycleState: "deleted" as const,
            aggregateVersion: transaction.aggregateVersion + 1,
          };
        }
        return copyTransaction(transaction);
      });
      return commit(
        command.operationKey,
        { [merged.transactionId]: command.expectedVersion },
        {
          transactionIds: distinct([
            command.mergedTransactionId,
            ...leafIds,
          ]),
        },
        state,
        replaceTransactions(state, next),
        leafIds,
      );
    },

    cancelCapturedLineage: async (command) => {
      const replay = await input.store.findReceipt(command.cancellationKey);
      if (replay !== undefined) return replay;
      if (await input.store.hasIncompleteLegacyMergeSnapshot()) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      const lineageSelection = {
        captureLineageIds: [command.captureLineageId],
      };
      let state = await input.store.load(lineageSelection);
      const lineageTransactions = state.transactions.filter(
        (transaction) =>
          transaction.provenance.captureLineageId === command.captureLineageId,
      );
      const currentLineageVersion = Math.max(
        0,
        ...lineageTransactions.map((transaction) => transaction.aggregateVersion),
      );
      const claim = state.dedupClaims.find(
        (candidate) =>
          candidate.captureLineageId === command.captureLineageId &&
          candidate.state === "active",
      );
      if (
        claim === undefined ||
        currentLineageVersion !== command.expectedLineageVersion
      ) {
        return { kind: "conflict", code: "VERSION_MISMATCH" };
      }

      const lineageTransactionIds = new Set(
        lineageTransactions.map((transaction) => transaction.transactionId),
      );
      state = mergeStates(
        state,
        await input.store.load({
          mergeLeafIds: [...lineageTransactionIds],
        }),
      );
      const cancellationPlan = () =>
        planCaptureLineageCancellation({
          captureLineageId: command.captureLineageId,
          transactions: state.transactions.map((transaction) => ({
            transactionId: transaction.transactionId,
            lifecycleState: transaction.lifecycleState,
            captureLineageIds: [transaction.provenance.captureLineageId],
            parentTransactionIds: [
              transaction.derivedFromTransactionId,
              transaction.splitOriginalId,
            ].filter((value): value is string => value !== undefined),
            mergeLeafIds: transaction.mergeLeafIds ?? [],
          })),
        });
      let plan = cancellationPlan();
      if (plan.invalidGraph) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      const alreadyLoaded = new Set(
        state.transactions.map((transaction) => transaction.transactionId),
      );
      const missingRestorableLeafIds = plan.restorableLeafIds.filter(
        (transactionId) => !alreadyLoaded.has(transactionId),
      );
      state = await includeTransactions(state, missingRestorableLeafIds);
      plan = cancellationPlan();
      if (
        plan.invalidGraph ||
        plan.restorableLeafIds.some(
          (transactionId) =>
            !state.transactions.some(
              (transaction) => transaction.transactionId === transactionId,
            ),
        )
      ) {
        return {
          kind: "contract-failure",
          code: "RESTORATION_SNAPSHOT_INCOMPLETE",
        };
      }
      const removedIds = new Set(plan.affectedTransactionIds);
      const restorableLeafIds = new Set(plan.restorableLeafIds);
      const nextTransactions = state.transactions
        .filter((transaction) => !removedIds.has(transaction.transactionId))
        .map((transaction) =>
          restorableLeafIds.has(transaction.transactionId)
            ? {
                ...copyTransaction(transaction),
                lifecycleState: "active" as const,
                aggregateVersion: transaction.aggregateVersion + 1,
              }
            : copyTransaction(transaction),
        );
      const nextState: LedgerTransformationState = {
        transactions: nextTransactions,
        dedupClaims: state.dedupClaims.map((candidate) =>
          candidate.captureLineageId === command.captureLineageId
            ? { ...candidate, state: "cancelled" as const }
            : { ...candidate },
        ),
        cancelledLineages: [
          ...state.cancelledLineages.map((entry) => ({ ...entry })),
          {
            captureLineageId: command.captureLineageId,
            fingerprint: claim.fingerprint,
            cancelledAt: input.clock.now(),
            receiptRef: command.cancellationKey,
          },
        ],
      };
      return commit(
        command.cancellationKey,
        expectedFor(lineageTransactions),
        {
          transactionIds: missingRestorableLeafIds,
          captureLineageIds: [command.captureLineageId],
          mergeLeafIds: [...lineageTransactionIds],
        },
        state,
        nextState,
        nextTransactions
          .filter((transaction) => restorableLeafIds.has(transaction.transactionId))
          .map((transaction) => transaction.transactionId),
        undefined,
        true,
      );
    },
  };
}
