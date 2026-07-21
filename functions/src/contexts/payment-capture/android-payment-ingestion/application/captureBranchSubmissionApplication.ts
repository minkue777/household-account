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
    const claim = await this.dependencies.receipts.claim({
      envelope,
      payloadFingerprint: this.dependencies.payloads.fingerprint(envelope),
    });
    if (claim.kind === "conflict") return claim;

    let receipt = claim.receipt;
    if (hasIncompleteBranch(receipt)) {
      receipt = { ...receipt, state: "processing" };
      await this.dependencies.receipts.save(receipt);
    }

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
      await this.dependencies.receipts.save(receipt);
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
      await this.dependencies.receipts.save(receipt);
    }

    const completion = completionOf(receipt);
    const terminalReceipt: CaptureSubmissionReceipt = {
      ...receipt,
      state:
        completion === "terminal" ? "completed" : "partial-retryable",
    };
    if (terminalReceipt.state !== receipt.state) {
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
