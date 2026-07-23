import { createCaptureBranchSubmissionApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import type { CaptureReceiptBranch } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import type { CaptureTransactionGatewayPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureTransactionGatewayPort";
import type {
  CaptureBalanceBranchResult,
  CaptureBranchSubmissionInputPort,
  CaptureBranchSubmissionOutcome,
  CaptureTransactionBranchResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";
import type {
  BalanceObservationIntakeInputPort,
  BalanceObservationIntakeResult,
  BalanceObservationV1,
  BalanceRecorderActor,
} from "../../src/contexts/household-finance/local-currency/public";
import { createBalanceObservationIntakeFixtureSubject } from "./local-currency-balance-driver";
import {
  InMemoryCaptureSubmissionReceiptStore,
  Sha256CapturePayloadFingerprint,
} from "./capture-branch-receipt-fixture";

export type {
  CaptureBalanceBranchResult,
  CaptureBranchEnvelope,
  CaptureBranchSubmissionInputPort,
  CaptureBranchSubmissionOutcome,
  CaptureBranchSubmissionResult,
  CaptureTransactionBranchResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface BalanceBranchIntegrationSnapshot {
  readonly ledgerTransactions: readonly {
    transactionId: string;
    householdId: string;
    merchant: string;
    amountInWon: number;
  }[];
  readonly balances: readonly {
    balanceId: string;
    householdId: string;
    localCurrencyType: "gyeonggi" | "daejeon" | "sejong";
    balanceInWon: number;
    balanceVersion: number;
  }[];
  readonly receipts: readonly {
    rootIdempotencyKey: string;
    transaction:
      | { readonly stage: "absent" }
      | {
          readonly stage: "terminal" | "retryable";
          readonly downstreamKey: string;
          readonly resultKind: CaptureTransactionBranchResult["kind"];
        };
    balance:
      | { readonly stage: "absent" }
      | {
          readonly stage: "terminal" | "retryable";
          readonly downstreamKey: string;
          readonly resultKind: CaptureBalanceBranchResult["kind"];
        };
  }[];
  readonly downstreamAttempts: { readonly transaction: number; readonly balance: number };
  readonly events: readonly {
    eventType: "TransactionRecorded.v1" | "LocalCurrencyBalanceChanged.v1";
    aggregateId: string;
  }[];
}

export interface BalanceBranchIntegrationDriver
  extends CaptureBranchSubmissionInputPort {
  snapshot(): Promise<BalanceBranchIntegrationSnapshot>;
}

export interface BalanceBranchIntegrationFixture {
  readonly transactionOutcomes?: readonly (
    | "recorded"
    | "registered-card-rejected"
    | "retryable-failure"
  )[];
  readonly balanceOutcomes?: readonly ("recorded" | "retryable-failure")[];
}

class ScriptedTransactionGateway implements CaptureTransactionGatewayPort {
  private outcomeIndex = 0;
  private attemptCount = 0;
  private transactionSequence = 0;
  private readonly terminalResults = new Map<
    string,
    CaptureTransactionBranchResult
  >();
  private readonly transactions: {
    transactionId: string;
    householdId: string;
    merchant: string;
    amountInWon: number;
  }[] = [];
  private readonly events: {
    eventType: "TransactionRecorded.v1";
    aggregateId: string;
  }[] = [];

  constructor(
    private readonly outcomes: readonly (
      | "recorded"
      | "registered-card-rejected"
      | "retryable-failure"
    )[],
  ) {}

  async record(
    input: Parameters<CaptureTransactionGatewayPort["record"]>[0],
  ): Promise<CaptureTransactionBranchResult> {
    this.attemptCount += 1;
    const replay = this.terminalResults.get(input.downstreamKey);
    if (replay !== undefined) return { ...replay };

    const outcome = this.outcomes[this.outcomeIndex] ?? "recorded";
    this.outcomeIndex += 1;
    if (outcome === "retryable-failure") {
      return { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
    }
    if (outcome === "registered-card-rejected") {
      const result = {
        kind: "rejected" as const,
        code: "CARD_NOT_REGISTERED_FOR_ACTOR" as const,
      };
      this.terminalResults.set(input.downstreamKey, result);
      return result;
    }

    this.transactionSequence += 1;
    const transactionId = `captured-transaction-${this.transactionSequence}`;
    const result = {
      kind: "recorded" as const,
      transactionId,
      editable: true as const,
      captureLineageId: `capture-lineage-${this.transactionSequence}`,
      aggregateVersion: 1,
      quickEditSnapshot: {
        transactionId,
        merchant: input.branch.merchant,
        amountInWon: input.branch.amountInWon,
        accountingDate: input.branch.accountingDate,
        localTime: input.branch.occurredAt.slice(11, 16),
        categoryId: "etc",
        memo: "",
        aggregateVersion: 1,
      },
    };
    this.terminalResults.set(input.downstreamKey, result);
    this.transactions.push({
      transactionId,
      householdId: input.householdId,
      merchant: input.branch.merchant,
      amountInWon: input.branch.amountInWon,
    });
    this.events.push({ eventType: "TransactionRecorded.v1", aggregateId: transactionId });
    return result;
  }

  attempts(): number {
    return this.attemptCount;
  }

  transactionViews(): readonly {
    transactionId: string;
    householdId: string;
    merchant: string;
    amountInWon: number;
  }[] {
    return this.transactions.map((transaction) => ({ ...transaction }));
  }

  eventViews(): readonly {
    eventType: "TransactionRecorded.v1";
    aggregateId: string;
  }[] {
    return this.events.map((event) => ({ ...event }));
  }
}

class ScriptedBalanceIntake implements BalanceObservationIntakeInputPort {
  private outcomeIndex = 0;
  private attemptCount = 0;

  constructor(
    private readonly outcomes: readonly ("recorded" | "retryable-failure")[],
    private readonly delegate: BalanceObservationIntakeInputPort,
  ) {}

  async recordBalanceObservation(
    actor: BalanceRecorderActor,
    input: BalanceObservationV1,
  ): Promise<BalanceObservationIntakeResult> {
    this.attemptCount += 1;
    const outcome = this.outcomes[this.outcomeIndex] ?? "recorded";
    this.outcomeIndex += 1;
    if (outcome === "retryable-failure") {
      throw new Error("fixture balance repository unavailable");
    }
    return this.delegate.recordBalanceObservation(actor, input);
  }

  attempts(): number {
    return this.attemptCount;
  }
}

function branchView<TResult extends { readonly kind: string }>(
  branch: CaptureReceiptBranch<TResult>,
):
  | { readonly stage: "absent" }
  | {
      readonly stage: "terminal" | "retryable";
      readonly downstreamKey: string;
      readonly resultKind: TResult["kind"];
    } {
  if (branch.stage === "absent") return branch;
  if (branch.stage === "pending") {
    throw new Error("submit 완료 뒤 pending branch가 남아서는 안 됩니다.");
  }
  return {
    stage: branch.stage,
    downstreamKey: branch.downstreamKey,
    resultKind: branch.result.kind,
  };
}

export function createBalanceBranchIntegrationDriver(
  fixture: BalanceBranchIntegrationFixture = {},
): BalanceBranchIntegrationDriver {
  const receipts = new InMemoryCaptureSubmissionReceiptStore();
  const ledger = new ScriptedTransactionGateway(
    fixture.transactionOutcomes ?? [],
  );
  const localCurrency = createBalanceObservationIntakeFixtureSubject();
  const balances = new ScriptedBalanceIntake(
    fixture.balanceOutcomes ?? [],
    localCurrency,
  );
  const application = createCaptureBranchSubmissionApplication({
    receipts,
    payloads: new Sha256CapturePayloadFingerprint(),
    transactions: ledger,
    balances,
  });

  return {
    submit: (envelope): Promise<CaptureBranchSubmissionOutcome> =>
      application.submit(envelope),
    snapshot: async (): Promise<BalanceBranchIntegrationSnapshot> => {
      const balanceSnapshot = await localCurrency.snapshot();
      const balanceEvents = await localCurrency.publishedEvents();
      return {
        ledgerTransactions: ledger.transactionViews(),
        balances: balanceSnapshot.balances,
        receipts: receipts.list().map((receipt) => ({
          rootIdempotencyKey: receipt.rootIdempotencyKey,
          transaction: branchView(receipt.transaction),
          balance: branchView(receipt.balance),
        })),
        downstreamAttempts: {
          transaction: ledger.attempts(),
          balance: balances.attempts(),
        },
        events: [
          ...ledger.eventViews(),
          ...balanceEvents.map((event) => ({
            eventType: event.eventType,
            aggregateId: event.balanceId,
          })),
        ],
      };
    },
  };
}
