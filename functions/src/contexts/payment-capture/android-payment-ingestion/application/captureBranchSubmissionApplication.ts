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

    let receipt = claim.receipt;
    const shouldProcess = hasIncompleteBranch(receipt);

    const transactionReceipt = receipt.transaction;
    if (
      envelope.transactionBranch !== undefined &&
      transactionReceipt.stage !== "absent" &&
      transactionReceipt.stage !== "terminal"
    ) {
      const transactionResult = await this.dependencies.transactions.record({
        householdId: envelope.householdId,
        downstreamKey: transactionReceipt.downstreamKey,
        branch: envelope.transactionBranch,
      });
      receipt = {
        ...receipt,
        transaction: completedBranch(
          transactionReceipt,
          transactionResult,
          isRetryable(transactionResult),
        ),
      };
    }

    const balanceReceipt = receipt.balance;
    if (
      envelope.balanceBranch !== undefined &&
      balanceReceipt.stage !== "absent" &&
      balanceReceipt.stage !== "terminal"
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
      receipt = {
        ...receipt,
        balance: completedBranch(
          balanceReceipt,
          balanceResult,
          isRetryable(balanceResult),
        ),
      };
    }

    const completion = completionOf(receipt);
    const terminalReceipt: CaptureSubmissionReceipt = {
      ...receipt,
      state:
        completion === "terminal" ? "completed" : "partial-retryable",
    };
    // Downstream ledger/balance는 각자의 idempotency key로 재생할 수 있습니다.
    // 따라서 중간 processing/branch 상태를 매번 직렬 transaction으로 저장하지 않고,
    // 이번 실행의 모든 branch 결과를 마지막에 한 번만 root receipt에 반영합니다.
    if (shouldProcess || terminalReceipt.state !== claim.receipt.state) {
      await this.dependencies.receipts.save(terminalReceipt);
    }

    return {
      kind: "accepted",
      completion,
      ...(terminalReceipt.transaction.stage === "absent"
        ? {}
        : { transactionResult: resultOf(terminalReceipt.transaction) }),
      ...(terminalReceipt.balance.stage === "absent"
        ? {}
        : { balanceResult: resultOf(terminalReceipt.balance) }),
    };
  }
}

export function createCaptureBranchSubmissionApplication(
  dependencies: CaptureBranchSubmissionDependencies,
): CaptureBranchSubmissionInputPort {
  return new DefaultCaptureBranchSubmissionApplication(dependencies);
}
