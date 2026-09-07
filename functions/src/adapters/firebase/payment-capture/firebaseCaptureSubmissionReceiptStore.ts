import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { CaptureBranchEnvelope } from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/in/captureBranchSubmissionInputPort";
import type {
  CapturePayloadFingerprintPort,
  CaptureReceiptBranch,
  CaptureReceiptClaimResult,
  CaptureSubmissionReceipt,
  CaptureSubmissionReceiptPort,
} from "../../../contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function receiptId(householdId: string, rootIdempotencyKey: string): string {
  return hash(`${householdId}\u0000${rootIdempotencyKey}`);
}

function terminalExpiry(now: string) {
  return firestoreTtlAfter(now);
}

function alreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    readonly code?: unknown;
    readonly message?: unknown;
  };
  return (
    candidate.code === 6 ||
    candidate.code === "6" ||
    candidate.code === "already-exists" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("ALREADY_EXISTS"))
  );
}

function canonicalEnvelope(envelope: CaptureBranchEnvelope): unknown {
  // approvalAmountInWon은 원문 hash에서 재현되는 서버 파생 증거입니다.
  // 이를 추가해도 배포 전 receipt와 동일한 입력 identity를 유지합니다.
  const transaction = envelope.transactionBranch;
  const context = transaction?.captureContext;
  const balance = envelope.balanceBranch;
  return [
    envelope.householdId,
    envelope.rootIdempotencyKey,
    envelope.captureEnvelopeIdentity ?? null,
    transaction === undefined
      ? null
      : [
          transaction.branchKey,
          transaction.merchant,
          transaction.amountInWon,
          transaction.occurredAt,
          transaction.accountingDate,
          transaction.sourceType,
          transaction.parser.parserId,
          transaction.parser.parserVersion,
          transaction.rawPayloadHash,
          transaction.localCurrencyType ?? null,
          context === undefined
            ? null
            : [
                context.observationId,
                context.observationType,
                context.originChannel,
                context.creatorMemberId,
                context.cardEvidence?.companyLabel ?? null,
                context.cardEvidence?.maskedToken ?? null,
                ...(context.paymentKind === undefined
                  ? []
                  : [context.paymentKind]),
                ...(context.billDueDate === undefined
                  ? []
                  : [context.billDueDate]),
              ],
        ],
    balance === undefined ? null : balance,
  ];
}

export class Sha256CapturePayloadFingerprint
  implements CapturePayloadFingerprintPort
{
  fingerprint(envelope: CaptureBranchEnvelope): string {
    return `sha256:${hash(JSON.stringify(canonicalEnvelope(envelope)))}`;
  }
}

function fromData(
  data: FirebaseFirestore.DocumentData,
): CaptureSubmissionReceipt {
  return {
    householdId: data.householdId as string,
    rootIdempotencyKey: data.rootIdempotencyKey as string,
    payloadFingerprint: data.payloadFingerprint as string,
    state: data.state as CaptureSubmissionReceipt["state"],
    transaction: data.transaction as CaptureSubmissionReceipt["transaction"],
    balance: data.balance as CaptureSubmissionReceipt["balance"],
  };
}

function branchRank(branch: CaptureReceiptBranch<unknown>): number {
  switch (branch.stage) {
    case "absent":
      return 0;
    case "pending":
      return 1;
    case "retryable":
      return 2;
    case "terminal":
      return 3;
  }
}

function advancedBranch<TResult>(
  current: CaptureReceiptBranch<TResult>,
  next: CaptureReceiptBranch<TResult>,
): CaptureReceiptBranch<TResult> {
  if (current.stage === "absent" || next.stage === "absent") {
    if (current.stage !== next.stage) {
      throw new Error("CAPTURE_RECEIPT_BRANCH_MISMATCH");
    }
    return current;
  }
  if (current.downstreamKey !== next.downstreamKey) {
    throw new Error("CAPTURE_RECEIPT_BRANCH_MISMATCH");
  }
  // A terminal result is immutable, including when another execution also finished.
  if (current.stage === "terminal") return current;
  return branchRank(next) >= branchRank(current) ? next : current;
}

function mergedState(
  current: CaptureSubmissionReceipt,
  next: CaptureSubmissionReceipt,
  transaction: CaptureSubmissionReceipt["transaction"],
  balance: CaptureSubmissionReceipt["balance"],
): CaptureSubmissionReceipt["state"] {
  const branches = [transaction, balance];
  if (branches.every(branch => branch.stage === "absent" || branch.stage === "terminal")) {
    return "completed";
  }
  if (branches.some(branch => branch.stage === "retryable")
    || current.state === "partial-retryable" || next.state === "partial-retryable") {
    return "partial-retryable";
  }
  return current.state === "processing" || next.state === "processing"
    ? "processing" : "claimed";
}

export class FirebaseCaptureSubmissionReceiptStore
  implements CaptureSubmissionReceiptPort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async claim(input: {
    readonly envelope: CaptureBranchEnvelope;
    readonly payloadFingerprint: string;
  }): Promise<CaptureReceiptClaimResult> {
    const reference = this.database
      .collection("households")
      .doc(input.envelope.householdId)
      .collection("captureSubmissionReceipts")
      .doc(
        receiptId(
          input.envelope.householdId,
          input.envelope.rootIdempotencyKey,
        ),
      );
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
    try {
      await reference.create({
        ...receipt,
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: "claimed", receipt } as const;
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }

    const snapshot = await reference.get();
    if (!snapshot.exists) throw new Error("CAPTURE_RECEIPT_CONCURRENTLY_REMOVED");
    const existing = fromData(snapshot.data() ?? {});
    return existing.payloadFingerprint === input.payloadFingerprint
      ? ({ kind: "existing", receipt: existing } as const)
      : ({
          kind: "conflict",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        } as const);
  }

  async save(receipt: CaptureSubmissionReceipt): Promise<CaptureSubmissionReceipt> {
    const reference = this.database
      .collection("households")
      .doc(receipt.householdId)
      .collection("captureSubmissionReceipts")
      .doc(receiptId(receipt.householdId, receipt.rootIdempotencyKey));
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error("CAPTURE_RECEIPT_NOT_CLAIMED");
      const current = fromData(snapshot.data() ?? {});
      if (current.payloadFingerprint !== receipt.payloadFingerprint) {
        throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      if (current.householdId !== receipt.householdId
        || current.rootIdempotencyKey !== receipt.rootIdempotencyKey) {
        throw new Error("CAPTURE_RECEIPT_IDENTITY_MISMATCH");
      }
      const nextTransaction = advancedBranch(current.transaction, receipt.transaction);
      const nextBalance = advancedBranch(current.balance, receipt.balance);
      // Replay must preserve the first terminal results and their original TTL.
      if (current.state === "completed") return current;
      const state = mergedState(current, receipt, nextTransaction, nextBalance);
      if (state === current.state && nextTransaction === current.transaction && nextBalance === current.balance) {
        return current;
      }
      const saved: CaptureSubmissionReceipt = {
        ...current,
        state,
        transaction: nextTransaction,
        balance: nextBalance,
      };
      const now = this.now();
      transaction.set(
        reference,
        {
          state,
          transaction: saved.transaction,
          balance: saved.balance,
          updatedAt: FieldValue.serverTimestamp(),
          ...(state === "completed"
            ? { terminalAt: now, expiresAt: terminalExpiry(now) }
            : {}),
        },
        { merge: true },
      );
      return saved;
    });
  }
}
