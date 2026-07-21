import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  FirebaseCaptureSubmissionReceiptStore,
  Sha256CapturePayloadFingerprint,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import type { CaptureBranchEnvelope } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/captureBranchSubmissionInputPort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function envelope(): CaptureBranchEnvelope {
  return {
    householdId: "house-1",
    rootIdempotencyKey: "observation-1",
    captureEnvelopeIdentity: {
      contractVersion: "capture-envelope.v1",
      observationId: "observation-1",
      originChannel: "android-notification",
      sourceIdentity: "registered:kb-card",
      observedAt: "2026-07-21T10:05:01+09:00",
      parserId: "kb-card-parser",
      parserVersion: "2.0.0",
      rawPayloadHash:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    },
    transactionBranch: {
      branchKey: "payment-1",
      merchant: "가맹점 A",
      amountInWon: 12_000,
      occurredAt: "2026-07-21T10:05:00+09:00",
      accountingDate: "2026-07-21",
      sourceType: "kb-card",
      parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
      rawPayloadHash:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      captureContext: {
        observationId: "observation-1",
        observationType: "approval",
        originChannel: "android-notification",
        creatorMemberId: "member-1",
        cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
      },
    },
  };
}

describe("Firebase Capture root receipt adapter", () => {
  it("동일 root·payload는 branch 종단 결과를 재생하고 payload 변경은 충돌시킨다", async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebaseCaptureSubmissionReceiptStore(
      memory as unknown as firestore.Firestore,
      () => "2026-07-21T10:06:00+09:00",
    );
    const payloads = new Sha256CapturePayloadFingerprint();
    const input = envelope();
    const fingerprint = payloads.fingerprint(input);

    const first = await store.claim({
      envelope: input,
      payloadFingerprint: fingerprint,
    });
    expect(first).toMatchObject({
      kind: "claimed",
      receipt: {
        state: "claimed",
        transaction: { stage: "pending", downstreamKey: "payment-1" },
        balance: { stage: "absent" },
      },
    });
    if (first.kind !== "claimed") return;
    await store.save({
      ...first.receipt,
      state: "completed",
      transaction: {
        stage: "terminal",
        downstreamKey: "payment-1",
        result: {
          kind: "recorded",
          transactionId: "transaction-1",
          editable: true,
          captureLineageId: "lineage-1",
          aggregateVersion: 1,
        },
      },
    });

    expect(
      await store.claim({ envelope: input, payloadFingerprint: fingerprint }),
    ).toMatchObject({
      kind: "existing",
      receipt: {
        state: "completed",
        transaction: {
          stage: "terminal",
          result: { kind: "recorded", aggregateVersion: 1 },
        },
      },
    });
    expect(
      await store.claim({
        envelope: { ...input, transactionBranch: { ...input.transactionBranch!, amountInWon: 12_001 } },
        payloadFingerprint: payloads.fingerprint({
          ...input,
          transactionBranch: { ...input.transactionBranch!, amountInWon: 12_001 },
        }),
      }),
    ).toEqual({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(memory.paths("households/house-1/captureSubmissionReceipts/")).toHaveLength(1);
  });
});
