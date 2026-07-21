import { createCapturedLineageCancellationCommands } from "../../src/contexts/household-finance/ledger/application/commands/cancelCapturedLineage";
import type { CapturedLineageCancellationStore } from "../../src/contexts/household-finance/ledger/application/ports/capturedLineageCancellationStore";
import type {
  CapturedLineageCancellationResult,
  CapturedLineageCancellationState,
} from "../../src/contexts/household-finance/ledger/domain/model/capturedLineageCancellation";
import { createCancellationExecutionApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/cancellationExecutionApplication";
import type { CapturedLineageCancellationPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/capturedLineageCancellationPort";
import type {
  CancellationExecutionInputPort,
  CancelCapturedLineageResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  CancellationExecutionInputPort,
  CancelCapturedLineageResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CancellationTransactionFixture {
  readonly transactionId: string;
  readonly captureLineageId: string;
  readonly groupId?: string;
  readonly state: "active" | "superseded";
}

export interface CancellationAtomicityState {
  readonly transactions: readonly CancellationTransactionFixture[];
  readonly cancellationReceipts: readonly {
    readonly captureLineageId: string;
    readonly deletedTransactionIds: readonly string[];
  }[];
  readonly captureClaimTombstones: readonly {
    readonly captureLineageId: string;
    readonly receiptId: string;
  }[];
  readonly completionEventLineageIds: readonly string[];
}

export interface CancellationAtomicityFixture {
  readonly lineageVersion: number;
  readonly transactions: readonly CancellationTransactionFixture[];
  readonly commitOutcome?: "success" | "failure";
  readonly now?: string;
}

export interface CancellationAtomicityDriver
  extends CancellationExecutionInputPort {
  state(): CancellationAtomicityState;
}

function cloneLedgerState(
  state: CapturedLineageCancellationState,
): CapturedLineageCancellationState {
  return {
    transactions: state.transactions.map((transaction) => ({
      ...transaction,
      ...(transaction.monthlyGroup === undefined
        ? {}
        : { monthlyGroup: { ...transaction.monthlyGroup } }),
    })),
    claims: state.claims.map((claim) => ({ ...claim })),
    cancelledLineages: state.cancelledLineages.map((entry) => ({ ...entry })),
    events: state.events.map((event) => ({
      ...event,
      deletedTransactionIds: [...event.deletedTransactionIds],
    })),
  };
}

class AtomicCancellationFixtureStore
  implements CapturedLineageCancellationStore
{
  private ledgerState: CapturedLineageCancellationState;
  private readonly receipts = new Map<
    string,
    CapturedLineageCancellationResult
  >();

  constructor(
    state: CapturedLineageCancellationState,
    private readonly commitOutcome: "success" | "failure",
  ) {
    this.ledgerState = cloneLedgerState(state);
  }

  async findReceipt(
    cancellationKey: string,
  ): Promise<CapturedLineageCancellationResult | undefined> {
    const receipt = this.receipts.get(cancellationKey);
    return receipt === undefined
      ? undefined
      : receipt.kind === "Cancelled"
        ? { ...receipt, deletedTransactionIds: [...receipt.deletedTransactionIds] }
        : { ...receipt };
  }

  async load() {
    return { kind: "ready" as const, value: cloneLedgerState(this.ledgerState) };
  }

  async commit(input: {
    cancellationKey: string;
    state: CapturedLineageCancellationState;
    result: Extract<CapturedLineageCancellationResult, { kind: "Cancelled" }>;
  }) {
    if (this.commitOutcome === "failure") {
      return {
        kind: "RetryableFailure" as const,
        code: "ATOMIC_COMMIT_FAILED",
      };
    }

    this.ledgerState = cloneLedgerState(input.state);
    this.receipts.set(input.cancellationKey, {
      ...input.result,
      deletedTransactionIds: [...input.result.deletedTransactionIds],
    });
    return { kind: "success" as const };
  }

  state(): CapturedLineageCancellationState {
    return cloneLedgerState(this.ledgerState);
  }

  receiptResults(): readonly Extract<
    CapturedLineageCancellationResult,
    { kind: "Cancelled" }
  >[] {
    return [...this.receipts.values()]
      .filter(
        (
          result,
        ): result is Extract<
          CapturedLineageCancellationResult,
          { kind: "Cancelled" }
        > => result.kind === "Cancelled",
      )
      .map((result) => ({
        ...result,
        deletedTransactionIds: [...result.deletedTransactionIds],
      }));
  }
}

class FixtureCapturedLineageCancellationAdapter
  implements CapturedLineageCancellationPort
{
  constructor(
    private readonly commands: ReturnType<
      typeof createCapturedLineageCancellationCommands
    >,
    private readonly store: AtomicCancellationFixtureStore,
    private readonly groupIds: ReadonlyMap<string, string>,
  ) {}

  async cancel(input: {
    readonly actor: { readonly householdId: string; readonly memberId: string };
    readonly cancellationKey: string;
    readonly captureLineageId: string;
    readonly expectedLineageVersion: number;
  }): Promise<
    Exclude<
      CancelCapturedLineageResult,
      { kind: "NeedsConfirmation" }
    >
  > {
    const current = this.store.state();
    const expectedVersions: Record<string, number> = {
      [input.captureLineageId]: input.expectedLineageVersion,
    };
    for (const transaction of current.transactions) {
      if (transaction.captureLineageId === input.captureLineageId) {
        expectedVersions[transaction.transactionId] =
          transaction.aggregateVersion;
      }
    }

    const result = await this.commands.cancel({
      actor: input.actor,
      cancellationKey: input.cancellationKey,
      captureLineageId: input.captureLineageId,
      expectedVersions,
    });
    switch (result.kind) {
      case "Cancelled":
        return {
          ...result,
          ...(this.groupIds.get(result.captureLineageId) === undefined
            ? {}
            : { groupId: this.groupIds.get(result.captureLineageId) }),
        };
      case "AlreadyCancelled":
        return result;
      case "NotFound":
        return { kind: "NotFound", resource: "cancellationTarget" };
      case "Conflict":
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      case "RetryableFailure":
        return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
    }
  }
}

class DefaultCancellationAtomicityDriver
  implements CancellationAtomicityDriver
{
  constructor(
    private readonly application: CancellationExecutionInputPort,
    private readonly store: AtomicCancellationFixtureStore,
    private readonly fixtureTransactions: ReadonlyMap<
      string,
      CancellationTransactionFixture
    >,
  ) {}

  cancel(
    input: Parameters<CancellationExecutionInputPort["cancel"]>[0],
  ): Promise<CancelCapturedLineageResult> {
    return this.application.cancel(input);
  }

  state(): CancellationAtomicityState {
    const ledgerState = this.store.state();
    const receipts = this.store.receiptResults();
    return {
      transactions: ledgerState.transactions.map((transaction) => ({
        ...this.fixtureTransactions.get(transaction.transactionId)!,
      })),
      cancellationReceipts: receipts.map((receipt) => ({
        captureLineageId: receipt.captureLineageId,
        deletedTransactionIds: [...receipt.deletedTransactionIds],
      })),
      captureClaimTombstones: ledgerState.claims
        .filter((claim) => claim.state === "cancelled")
        .map((claim) => ({
          captureLineageId: claim.captureLineageId,
          receiptId:
            ledgerState.cancelledLineages.find(
              (entry) =>
                entry.captureLineageId === claim.captureLineageId,
            )?.receiptId ?? "",
        })),
      completionEventLineageIds: ledgerState.events.flatMap((event) => {
        const receipt = receipts.find(
          (candidate) =>
            candidate.deletedTransactionIds.length ===
              event.deletedTransactionIds.length &&
            candidate.deletedTransactionIds.every((transactionId) =>
              event.deletedTransactionIds.includes(transactionId),
            ),
        );
        return receipt === undefined ? [] : [receipt.captureLineageId];
      }),
    };
  }
}

export function createCancellationAtomicityDriver(
  fixture: CancellationAtomicityFixture,
): CancellationAtomicityDriver {
  const fixtureTransactions = new Map(
    fixture.transactions.map((transaction) => [
      transaction.transactionId,
      { ...transaction },
    ]),
  );
  const groupIds = new Map<string, string>();
  for (const transaction of fixture.transactions) {
    if (transaction.groupId !== undefined) {
      groupIds.set(transaction.captureLineageId, transaction.groupId);
    }
  }
  const ledgerState: CapturedLineageCancellationState = {
    transactions: fixture.transactions.map((transaction) => ({
      transactionId: transaction.transactionId,
      householdId: "household-1",
      lifecycleState: transaction.state,
      amountInWon: 1,
      captureLineageId: transaction.captureLineageId,
      aggregateVersion: 1,
      ...(transaction.groupId === undefined
        ? {}
        : {
            monthlyGroup: {
              groupId: transaction.groupId,
              originalTransactionId:
                fixture.transactions.find(
                  (candidate) =>
                    candidate.captureLineageId === transaction.captureLineageId &&
                    candidate.state === "superseded",
                )?.transactionId ?? transaction.transactionId,
              index: 1,
              total: fixture.transactions.filter(
                (candidate) => candidate.groupId === transaction.groupId,
              ).length,
            },
          }),
    })),
    claims: [
      ...new Set(
        fixture.transactions.map((transaction) => transaction.captureLineageId),
      ),
    ].map((captureLineageId) => ({
      fingerprint: `fingerprint:${captureLineageId}`,
      captureLineageId,
      state: "active" as const,
    })),
    cancelledLineages: [],
    events: [],
  };
  const store = new AtomicCancellationFixtureStore(
    ledgerState,
    fixture.commitOutcome ?? "success",
  );
  const commands = createCapturedLineageCancellationCommands({
    store,
    clock: { now: () => fixture.now ?? "2026-07-20T00:00:00+09:00" },
  });
  const ledger = new FixtureCapturedLineageCancellationAdapter(
    commands,
    store,
    groupIds,
  );
  return new DefaultCancellationAtomicityDriver(
    createCancellationExecutionApplication(ledger),
    store,
    fixtureTransactions,
  );
}
