import type {
  CaptureBalanceBranchResult,
  CaptureBranchEnvelope,
  CaptureBranchSubmissionInputPort,
  CaptureBranchSubmissionOutcome,
  CaptureTransactionBranchResult,
} from "./ports/in/captureBranchSubmissionInputPort";
import type {
  CapturePayloadFingerprintPort,
  CaptureReceiptBranch,
  CaptureSubmissionReceipt,
  CaptureSubmissionReceiptPort,
} from "./ports/out/captureSubmissionReceiptPort";
import type { CaptureTransactionGatewayPort } from "./ports/out/captureTransactionGatewayPort";
import type { BalanceObservationIntakeInputPort } from "../../../household-finance/local-currency/public";

export interface CaptureBranchSubmissionDependencies {
  readonly receipts: CaptureSubmissionReceiptPort;
  readonly payloads: CapturePayloadFingerprintPort;
  readonly transactions: CaptureTransactionGatewayPort;
  readonly balances: BalanceObservationIntakeInputPort;
}

function isRetryable(
  result: CaptureTransactionBranchResult | CaptureBalanceBranchResult,
): boolean {
  return result.kind === "retryable-failure";
}

function completedBranch<TResult>(
  current: CaptureReceiptBranch<TResult>,
  result: TResult,
  retryable: boolean,
): CaptureReceiptBranch<TResult> {
  if (current.stage === "absent") return current;
  return {
    stage: retryable ? "retryable" : "terminal",
    downstreamKey: current.downstreamKey,
    result,
  };
}

function resultOf<TResult>(
  branch: CaptureReceiptBranch<TResult>,
): TResult | undefined {
  return branch.stage === "terminal" || branch.stage === "retryable"
    ? branch.result
    : undefined;
}

function completionOf(receipt: CaptureSubmissionReceipt):
  | "terminal"
  | "partial-retryable" {
  return receipt.transaction.stage === "retryable" ||
    receipt.balance.stage === "retryable"
    ? "partial-retryable"
    : "terminal";
}

function hasIncompleteBranch(receipt: CaptureSubmissionReceipt): boolean {
  return (
    receipt.transaction.stage === "pending" ||
    receipt.transaction.stage === "retryable" ||
    receipt.balance.stage === "pending" ||
    receipt.balance.stage === "retryable"
  );
}

class DefaultCaptureBranchSubmissionApplication
  implements CaptureBranchSubmissionInputPort
{
  constructor(private readonly dependencies: CaptureBranchSubmissionDependencies) {}

  async submit(
    envelope: CaptureBranchEnvelope,
  ): Promise<CaptureBranchSubmissionOutcome> {
    const transactionBranch = envelope.transactionBranch;
    const isAndroidApprovalOnly =
      transactionBranch?.captureContext?.originChannel ===
        "android-notification" &&
      transactionBranch.captureContext.observationType === "approval" &&
      envelope.balanceBranch === undefined;

    if (isAndroidApprovalOnly) {
      // 일반 Android 승인은 ledger가 거래·dedup·outbox·멱등 receipt를 하나의
      // Firestore transaction으로 확정합니다. 같은 의미의 root receipt를 앞뒤로
      // 한 번씩 더 쓰면 Quick Edit 표시만 늦어지므로 이 hot path에서는 생략합니다.
      const transactionResult = await this.dependencies.transactions.record({
        householdId: envelope.householdId,
        downstreamKey: envelope.rootIdempotencyKey,
        branch: transactionBranch,
      });
      if (
        transactionResult.kind === "rejected" &&
        transactionResult.code === "IDEMPOTENCY_PAYLOAD_MISMATCH"
      ) {
        return {
          kind: "conflict",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        };
      }
      return {
        kind: "accepted",
        completion: transactionResult.kind === "retryable-failure"
          ? "partial-retryable"
          : "terminal",
        transactionResult,
      };
    }

    const claim = await this.dependencies.receipts.claim({
      envelope,
      payloadFingerprint: this.dependencies.payloads.fingerprint(envelope),
    });
    if (claim.kind === "conflict") return claim;

    const shouldProcess = hasIncompleteBranch(claim.receipt);
    // 두 Context는 독립된 receipt로 확정됩니다. 한쪽의 실패가 다른 쪽의
    // 시작을 막지 않도록 병렬 실행하며, 예외도 분기 결과로 수렴한 뒤 저장합니다.
    const [transaction, balance] = await Promise.all([
      this.completeTransaction(envelope, claim.receipt.transaction),
      this.completeBalance(envelope, claim.receipt.balance),
    ]);
    const receipt = { ...claim.receipt, transaction, balance };
    const terminalReceipt: CaptureSubmissionReceipt = {
      ...receipt,
      state: completionOf(receipt) === "terminal" ? "completed" : "partial-retryable",
    };
    // 중간 branch 쓰기 없이 한 번만 병합합니다. 동시 재시도가 먼저 확정한
    // terminal 결과가 있으면 로컬 후보 대신 저장소가 반환한 결과를 재생합니다.
    const savedReceipt = shouldProcess || terminalReceipt.state !== claim.receipt.state
      ? await this.dependencies.receipts.save(terminalReceipt)
      : terminalReceipt;

    return {
      kind: "accepted",
      completion: completionOf(savedReceipt),
      ...(savedReceipt.transaction.stage === "absent"
        ? {}
        : { transactionResult: resultOf(savedReceipt.transaction) }),
      ...(savedReceipt.balance.stage === "absent"
        ? {}
        : { balanceResult: resultOf(savedReceipt.balance) }),
    };
  }

  private async completeTransaction(
    envelope: CaptureBranchEnvelope,
    current: CaptureReceiptBranch<CaptureTransactionBranchResult>,
  ): Promise<CaptureReceiptBranch<CaptureTransactionBranchResult>> {
    if (
      envelope.transactionBranch === undefined ||
      current.stage === "absent" ||
      current.stage === "terminal"
    ) return current;

    let result: CaptureTransactionBranchResult;
    try {
      result = await this.dependencies.transactions.record({
        householdId: envelope.householdId,
        downstreamKey: current.downstreamKey,
        branch: envelope.transactionBranch,
      });
    } catch {
      result = { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" };
    }
    return completedBranch(current, result, isRetryable(result));
  }

  private async completeBalance(
    envelope: CaptureBranchEnvelope,
    current: CaptureReceiptBranch<CaptureBalanceBranchResult>,
  ): Promise<CaptureReceiptBranch<CaptureBalanceBranchResult>> {
    if (
      envelope.balanceBranch !== undefined &&
      current.stage !== "absent" &&
      current.stage !== "terminal"
    ) {
      let balanceResult: CaptureBalanceBranchResult;
      try {
        const result = await this.dependencies.balances.recordBalanceObservation(
          {
            kind: "system",
            householdId: envelope.householdId,
            capabilities: ["local-currency.record"],
          },
          envelope.balanceBranch.observation,
        );
        balanceResult =
          result.kind === "success"
            ? {
                kind: "recorded",
                status: result.status,
                balanceId: result.balanceId,
                balanceVersion: result.balanceVersion,
              }
            : { kind: "rejected", code: result.code };
      } catch {
        balanceResult = {
          kind: "retryable-failure",
          code: "BALANCE_REPOSITORY_UNAVAILABLE",
        };
      }
      return completedBranch(current, balanceResult, isRetryable(balanceResult));
    }
    return current;
  }
}

export function createCaptureBranchSubmissionApplication(
  dependencies: CaptureBranchSubmissionDependencies,
): CaptureBranchSubmissionInputPort {
  return new DefaultCaptureBranchSubmissionApplication(dependencies);
}
