import { createTenantAuthorizationApplication } from "../../src/contexts/access/tenant-authorization/application/tenantAuthorizationApplication";
import { createCaptureBranchSubmissionApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import {
  createCaptureSubmissionApplication,
  toCaptureSubmittedBalanceResult,
  toCaptureSubmittedTransactionResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import type { CaptureTransactionGatewayPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureTransactionGatewayPort";
import type {
  CaptureReceiptBranch,
  CaptureSubmissionReceipt,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import type {
  CaptureBalanceBranchResult,
  CaptureSubmissionCommand,
  CaptureSubmissionInputPort,
  CaptureSubmittedBalanceResult,
  CaptureSubmittedTransactionResult,
  CaptureTransactionBranchResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";
import type {
  BalanceObservationIntakeInputPort,
  BalanceObservationIntakeResult,
  BalanceObservationV1,
  BalanceRecorderActor,
} from "../../src/contexts/household-finance/local-currency/public";
import {
  InMemoryCaptureSubmissionReceiptStore,
  Sha256CapturePayloadFingerprint,
} from "./capture-branch-receipt-fixture";

export type {
  CaptureSubmissionCommand,
  CaptureSubmissionInputPort,
  CaptureSubmissionOutcome,
  CaptureSubmissionResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CapturedTransactionView {
  readonly transactionId: string;
  readonly householdId: string;
  readonly creatorMemberId: string;
  readonly amountInWon: number;
  readonly occurredLocalDate: string;
  readonly occurredLocalTime: string;
  readonly merchant: string;
  readonly captureLineageId: string;
}

export interface SeedCapturedTransaction extends CapturedTransactionView {
  readonly cardEvidence: {
    readonly companyLabel: string;
    readonly maskedToken: string;
  };
}

export interface CaptureReceiptView {
  readonly householdId: string;
  readonly rootIdempotencyKey: string;
  readonly state: "completed" | "partial-retryable";
  readonly transactionBranch: {
    readonly branchId: string;
    readonly downstreamKey: string;
    readonly stage: "terminal" | "retryable";
    readonly result: CaptureSubmittedTransactionResult;
  };
  readonly balanceBranch?: {
    readonly branchId: string;
    readonly downstreamKey: string;
    readonly stage: "terminal" | "retryable";
    readonly result: CaptureSubmittedBalanceResult;
  };
}

export interface PublishedEventView {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
}

export interface CaptureSubmissionContractState {
  readonly transactions: readonly CapturedTransactionView[];
  readonly cancelledLineageIds: readonly string[];
  readonly balances: readonly {
    readonly balanceId: string;
    readonly householdId: string;
    readonly currencyType: "gyeonggi" | "daejeon" | "sejong";
    readonly balanceInWon: number;
    readonly version: number;
  }[];
  readonly receipts: readonly CaptureReceiptView[];
  readonly events: readonly PublishedEventView[];
  readonly receiptSaveCount: number;
  readonly downstreamAttempts: {
    readonly transaction: number;
    readonly balance: number;
  };
}

export interface CaptureSubmissionReceiptDriver extends CaptureSubmissionInputPort {
  state(): CaptureSubmissionContractState;
}

export interface CaptureSubmissionReceiptFixture {
  readonly existingTransactions?: readonly SeedCapturedTransaction[];
  readonly transactionOutcomes?: readonly ("default" | "retryable-failure")[];
  readonly balanceOutcomes?: readonly ("recorded" | "retryable-failure")[];
}

interface StoredCapturedTransaction extends SeedCapturedTransaction {}

function normalizedMerchant(merchant: string): string {
  return merchant.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function paymentFingerprint(input: {
  readonly householdId: string;
  readonly amountInWon: number;
  readonly occurredLocalDate: string;
  readonly occurredLocalTime: string;
  readonly merchant: string;
}): string {
  return JSON.stringify([
    input.householdId,
    input.occurredLocalDate,
    input.occurredLocalTime,
    input.amountInWon,
    normalizedMerchant(input.merchant),
  ]);
}

function occurredDateTime(occurredAt: string): {
  readonly occurredLocalDate: string;
  readonly occurredLocalTime: string;
} {
  return {
    occurredLocalDate: occurredAt.slice(0, 10),
    occurredLocalTime: occurredAt.slice(11, 16),
  };
}

function cloneTransactionResult(
  result: CaptureTransactionBranchResult,
): CaptureTransactionBranchResult {
  if (result.kind === "cancelled") {
    return { ...result, transactionIds: [...result.transactionIds] };
  }
  if (result.kind === "duplicate") {
    return { ...result, followUp: { ...result.followUp } };
  }
  return { ...result };
}

class CaptureLedgerFixture implements CaptureTransactionGatewayPort {
  private outcomeIndex = 0;
  private attemptCount = 0;
  private transactionSequence = 0;
  private lineageSequence = 0;
  private eventSequence = 0;
  private readonly transactions: StoredCapturedTransaction[];
  private readonly cancelledLineages: string[] = [];
  private readonly events: PublishedEventView[] = [];
  private readonly terminalResults = new Map<
    string,
    CaptureTransactionBranchResult
  >();
  private readonly fingerprintClaims = new Map<string, string>();

  constructor(
    existingTransactions: readonly SeedCapturedTransaction[],
    private readonly outcomes: readonly (
      | "default"
      | "retryable-failure"
    )[],
  ) {
    this.transactions = existingTransactions.map((transaction) => ({
      ...transaction,
      cardEvidence: { ...transaction.cardEvidence },
    }));
    for (const transaction of this.transactions) {
      this.fingerprintClaims.set(
        paymentFingerprint(transaction),
        transaction.transactionId,
      );
    }
  }

  async record(
    input: Parameters<CaptureTransactionGatewayPort["record"]>[0],
  ): Promise<CaptureTransactionBranchResult> {
    this.attemptCount += 1;
    const replay = this.terminalResults.get(input.downstreamKey);
    if (replay !== undefined) return cloneTransactionResult(replay);

    const scripted = this.outcomes[this.outcomeIndex] ?? "default";
    this.outcomeIndex += 1;
    if (scripted === "retryable-failure") {
      return { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
    }

    const context = input.branch.captureContext;
    if (context === undefined) {
      throw new Error("capture context가 있는 거래 branch가 필요합니다.");
    }
    const cardEvidence = context.cardEvidence;
    if (cardEvidence === undefined) {
      return { kind: "rejected", code: "CARD_EVIDENCE_REQUIRED" };
    }
    const occurred = occurredDateTime(input.branch.occurredAt);
    if (context.observationType === "cancellation") {
      const candidateIndex = this.transactions.findIndex(
        (transaction) =>
          transaction.householdId === input.householdId &&
          transaction.amountInWon === input.branch.amountInWon &&
          transaction.occurredLocalDate === occurred.occurredLocalDate &&
          transaction.occurredLocalTime === occurred.occurredLocalTime &&
          normalizedMerchant(transaction.merchant) ===
            normalizedMerchant(input.branch.merchant) &&
          transaction.cardEvidence.companyLabel ===
            cardEvidence.companyLabel &&
          transaction.cardEvidence.maskedToken ===
            cardEvidence.maskedToken,
      );
      if (candidateIndex < 0) {
        const result = {
          kind: "notFound" as const,
          resource: "cancellationTarget" as const,
        };
        this.terminalResults.set(input.downstreamKey, result);
        return result;
      }

      const lineageId = this.transactions[candidateIndex].captureLineageId;
      const cancelled = this.transactions.filter(
        ({ captureLineageId }) => captureLineageId === lineageId,
      );
      this.transactions.splice(
        0,
        this.transactions.length,
        ...this.transactions.filter(
          ({ captureLineageId }) => captureLineageId !== lineageId,
        ),
      );
      if (!this.cancelledLineages.includes(lineageId)) {
        this.cancelledLineages.push(lineageId);
      }
      const result = {
        kind: "cancelled" as const,
        transactionIds: cancelled.map(({ transactionId }) => transactionId),
      };
      this.terminalResults.set(input.downstreamKey, result);
      this.publish("CapturedLineageCancelled.v1", lineageId);
      return cloneTransactionResult(result);
    }

    const fingerprint = paymentFingerprint({
      householdId: input.householdId,
      amountInWon: input.branch.amountInWon,
      occurredLocalDate: occurred.occurredLocalDate,
      occurredLocalTime: occurred.occurredLocalTime,
      merchant: input.branch.merchant,
    });
    const existingTransactionId = this.fingerprintClaims.get(fingerprint);
    if (existingTransactionId !== undefined) {
      const followUp =
        context.originChannel === "ios-shortcut"
          ? {
              kind: "outboxQueued" as const,
              eventType: "CaptureDuplicateObserved.v1" as const,
              eventId: this.publish(
                "CaptureDuplicateObserved.v1",
                existingTransactionId,
              ),
            }
          : ({ kind: "notRequested" } as const);
      const result = {
        kind: "duplicate" as const,
        existingTransactionId,
        editable: true,
        followUp,
      };
      this.terminalResults.set(input.downstreamKey, result);
      return cloneTransactionResult(result);
    }

    this.transactionSequence += 1;
    this.lineageSequence += 1;
    const transactionId = `transaction-${this.transactionSequence}`;
    const captureLineageId = `lineage-${this.lineageSequence}`;
    this.transactions.push({
      transactionId,
      householdId: input.householdId,
      creatorMemberId: context.creatorMemberId,
      amountInWon: input.branch.amountInWon,
      occurredLocalDate: occurred.occurredLocalDate,
      occurredLocalTime: occurred.occurredLocalTime,
      merchant: input.branch.merchant,
      captureLineageId,
      cardEvidence: {
        companyLabel: cardEvidence.companyLabel,
        maskedToken: cardEvidence.maskedToken ?? "",
      },
    });
    this.fingerprintClaims.set(fingerprint, transactionId);
    const result = {
      kind: "recorded" as const,
      transactionId,
      editable: true as const,
      captureLineageId,
      aggregateVersion: 1,
      quickEditSnapshot: {
        transactionId,
        merchant: input.branch.merchant,
        amountInWon: input.branch.amountInWon,
        accountingDate: occurred.occurredLocalDate,
        localTime: occurred.occurredLocalTime,
        categoryId: "etc",
        memo: "",
        aggregateVersion: 1,
      },
    };
    this.terminalResults.set(input.downstreamKey, result);
    this.publish("TransactionRecorded.v1", transactionId);
    return result;
  }

  private publish(eventType: string, aggregateId: string): string {
    this.eventSequence += 1;
    const eventId = `event-${this.eventSequence}`;
    this.events.push({ eventId, eventType, aggregateId });
    return eventId;
  }

  attempts(): number {
    return this.attemptCount;
  }

  transactionViews(): readonly CapturedTransactionView[] {
    return this.transactions.map(({ cardEvidence: _cardEvidence, ...view }) => ({
      ...view,
    }));
  }

  cancelledLineageIds(): readonly string[] {
    return [...this.cancelledLineages];
  }

  eventViews(): readonly PublishedEventView[] {
    return this.events.map((event) => ({ ...event }));
  }
}

class CaptureBalanceFixture implements BalanceObservationIntakeInputPort {
  private outcomeIndex = 0;
  private attemptCount = 0;
  private balanceSequence = 0;
  private eventSequence = 0;
  private readonly balances: {
    balanceId: string;
    householdId: string;
    currencyType: "gyeonggi" | "daejeon" | "sejong";
    balanceInWon: number;
    version: number;
  }[] = [];
  private readonly events: PublishedEventView[] = [];

  constructor(
    private readonly outcomes: readonly (
      | "recorded"
      | "retryable-failure"
    )[],
  ) {}

  async recordBalanceObservation(
    actor: BalanceRecorderActor,
    input: BalanceObservationV1,
  ): Promise<BalanceObservationIntakeResult> {
    this.attemptCount += 1;
    const scripted = this.outcomes[this.outcomeIndex] ?? "recorded";
    this.outcomeIndex += 1;
    if (scripted === "retryable-failure") {
      throw new Error("fixture balance repository unavailable");
    }
    if (actor.householdId === undefined) {
      return { kind: "forbidden", code: "HOUSEHOLD_REQUIRED" };
    }

    this.balanceSequence += 1;
    const balanceId = `balance-${this.balanceSequence}`;
    this.balances.push({
      balanceId,
      householdId: actor.householdId,
      currencyType: input.localCurrencyType,
      balanceInWon: input.balanceInWon,
      version: 1,
    });
    this.eventSequence += 1;
    this.events.push({
      eventId: `balance-event-${this.eventSequence}`,
      eventType: "LocalCurrencyBalanceChanged.v1",
      aggregateId: balanceId,
    });
    return {
      kind: "success",
      status: "created",
      balanceId,
      balanceVersion: 1,
    };
  }

  attempts(): number {
    return this.attemptCount;
  }

  balanceViews(): CaptureSubmissionContractState["balances"] {
    return this.balances.map((balance) => ({ ...balance }));
  }

  eventViews(): readonly PublishedEventView[] {
    return this.events.map((event) => ({ ...event }));
  }
}

function receiptState(
  receipt: CaptureSubmissionReceipt,
): "completed" | "partial-retryable" {
  if (receipt.state === "completed" || receipt.state === "partial-retryable") {
    return receipt.state;
  }
  throw new Error("submit 반환 뒤 root receipt는 종단 관찰 상태여야 합니다.");
}

function transactionBranchView(
  branch: CaptureReceiptBranch<CaptureTransactionBranchResult>,
): CaptureReceiptView["transactionBranch"] {
  if (branch.stage === "absent" || branch.stage === "pending") {
    throw new Error("transaction branch의 완료 결과가 필요합니다.");
  }
  return {
    branchId: branch.downstreamKey,
    downstreamKey: branch.downstreamKey,
    stage: branch.stage,
    result: toCaptureSubmittedTransactionResult(branch.result),
  };
}

function balanceBranchView(
  branch: CaptureReceiptBranch<CaptureBalanceBranchResult>,
): CaptureReceiptView["balanceBranch"] {
  if (branch.stage === "absent") return undefined;
  if (branch.stage === "pending") {
    throw new Error("balance branch의 완료 결과가 필요합니다.");
  }
  return {
    branchId: branch.downstreamKey,
    downstreamKey: branch.downstreamKey,
    stage: branch.stage,
    result: toCaptureSubmittedBalanceResult(branch.result),
  };
}

export function createCaptureSubmissionReceiptDriver(
  fixture: CaptureSubmissionReceiptFixture = {},
): CaptureSubmissionReceiptDriver {
  const receipts = new InMemoryCaptureSubmissionReceiptStore();
  const ledger = new CaptureLedgerFixture(
    fixture.existingTransactions ?? [],
    fixture.transactionOutcomes ?? [],
  );
  const balances = new CaptureBalanceFixture(fixture.balanceOutcomes ?? []);
  const branches = createCaptureBranchSubmissionApplication({
    receipts,
    payloads: new Sha256CapturePayloadFingerprint(),
    transactions: ledger,
    balances,
  });
  const tenantAuthorization = createTenantAuthorizationApplication({
    memberships: { findByPrincipalUid: async () => undefined },
  });
  const application = createCaptureSubmissionApplication({
    tenantAuthorization,
    branches,
  });

  return {
    submit: (command: CaptureSubmissionCommand) => application.submit(command),
    state: (): CaptureSubmissionContractState => ({
      transactions: ledger.transactionViews(),
      cancelledLineageIds: ledger.cancelledLineageIds(),
      balances: balances.balanceViews(),
      receipts: receipts.list().map((receipt) => ({
        householdId: receipt.householdId,
        rootIdempotencyKey: receipt.rootIdempotencyKey,
        state: receiptState(receipt),
        transactionBranch: transactionBranchView(receipt.transaction),
        ...(receipt.balance.stage === "absent"
          ? {}
          : { balanceBranch: balanceBranchView(receipt.balance) }),
      })),
      events: [...ledger.eventViews(), ...balances.eventViews()],
      receiptSaveCount: receipts.saveCount(),
      downstreamAttempts: {
        transaction: ledger.attempts(),
        balance: balances.attempts(),
      },
    }),
  };
}
