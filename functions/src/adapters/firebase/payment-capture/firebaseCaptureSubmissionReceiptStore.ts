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

function canonicalEnvelope(envelope: CaptureBranchEnvelope): unknown {
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
  return branchRank(next) >= branchRank(current) ? next : current;
}

function stateRank(state: CaptureSubmissionReceipt["state"]): number {
  return {
    claimed: 0,
    processing: 1,
    "partial-retryable": 2,
    completed: 3,
  }[state];
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
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const existing = fromData(snapshot.data() ?? {});
        return existing.payloadFingerprint === input.payloadFingerprint
          ? ({ kind: "existing", receipt: existing } as const)
          : ({
              kind: "conflict",
              code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            } as const);
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
      transaction.create(reference, {
        ...receipt,
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: "claimed", receipt } as const;
    });
  }

  async save(receipt: CaptureSubmissionReceipt): Promise<void> {
    const reference = this.database
      .collection("households")
      .doc(receipt.householdId)
      .collection("captureSubmissionReceipts")
      .doc(receiptId(receipt.householdId, receipt.rootIdempotencyKey));
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error("CAPTURE_RECEIPT_NOT_CLAIMED");
      const current = fromData(snapshot.data() ?? {});
      if (current.payloadFingerprint !== receipt.payloadFingerprint) {
        throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      const state =
        stateRank(receipt.state) >= stateRank(current.state)
          ? receipt.state
          : current.state;
      const now = this.now();
      transaction.set(
        reference,
        {
          state,
          transaction: advancedBranch(current.transaction, receipt.transaction),
          balance: advancedBranch(current.balance, receipt.balance),
          updatedAt: FieldValue.serverTimestamp(),
          ...(state === "completed"
            ? { terminalAt: now, expiresAt: terminalExpiry(now) }
            : {}),
        },
        { merge: true },
      );
    });
  }
}
