import type {
  CaptureReceiptBranch,
  CaptureReceiptClaimResult,
  CaptureSubmissionReceipt,
  CaptureSubmissionReceiptPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import type { CaptureBranchEnvelope } from "../../src/contexts/payment-capture/android-payment-ingestion/public";

function receiptKey(householdId: string, rootIdempotencyKey: string): string {
  return JSON.stringify([householdId, rootIdempotencyKey]);
}

function cloneValue<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function cloneBranch<TResult>(
  branch: CaptureReceiptBranch<TResult>,
): CaptureReceiptBranch<TResult> {
  return branch.stage === "terminal" || branch.stage === "retryable"
    ? { ...branch, result: cloneValue(branch.result) }
    : { ...branch };
}

function cloneReceipt(receipt: CaptureSubmissionReceipt): CaptureSubmissionReceipt {
  return {
    ...receipt,
    transaction: cloneBranch(receipt.transaction),
    balance: cloneBranch(receipt.balance),
  };
}

export class InMemoryCaptureSubmissionReceiptStore
  implements CaptureSubmissionReceiptPort
{
  private readonly receipts = new Map<string, CaptureSubmissionReceipt>();
  private saves = 0;

  async claim(input: {
    readonly envelope: CaptureBranchEnvelope;
    readonly payloadFingerprint: string;
  }): Promise<CaptureReceiptClaimResult> {
    const key = receiptKey(
      input.envelope.householdId,
      input.envelope.rootIdempotencyKey,
    );
    const existing = this.receipts.get(key);
    if (existing !== undefined) {
      return existing.payloadFingerprint === input.payloadFingerprint
        ? { kind: "existing", receipt: cloneReceipt(existing) }
        : { kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" };
    }

    const receipt: CaptureSubmissionReceipt = {
      householdId: input.envelope.householdId,
      rootIdempotencyKey: input.envelope.rootIdempotencyKey,
      payloadFingerprint: input.payloadFingerprint,
      state: "claimed",
      transaction:
        input.envelope.transactionBranch === undefined
          ? { stage: "absent" }
          : {
              stage: "pending",
              downstreamKey: input.envelope.transactionBranch.branchKey,
            },
      balance:
        input.envelope.balanceBranch === undefined
          ? { stage: "absent" }
          : {
              stage: "pending",
              downstreamKey: input.envelope.balanceBranch.branchKey,
            },
    };
    this.receipts.set(key, cloneReceipt(receipt));
    return { kind: "claimed", receipt: cloneReceipt(receipt) };
  }

  async save(receipt: CaptureSubmissionReceipt): Promise<CaptureSubmissionReceipt> {
    this.saves += 1;
    this.receipts.set(
      receiptKey(receipt.householdId, receipt.rootIdempotencyKey),
      cloneReceipt(receipt),
    );
    return cloneReceipt(receipt);
  }

  list(): readonly CaptureSubmissionReceipt[] {
    return [...this.receipts.values()].map(cloneReceipt);
  }

  saveCount(): number {
    return this.saves;
  }
}
