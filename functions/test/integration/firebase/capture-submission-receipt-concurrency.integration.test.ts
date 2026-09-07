import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FirebaseCaptureSubmissionReceiptStore, Sha256CapturePayloadFingerprint } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import type { CaptureBranchEnvelope } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/captureBranchSubmissionInputPort";
import type { CaptureSubmissionReceipt } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";

const PROJECT_ID = "demo-household-account-capture-receipt-concurrency";
const HOUSEHOLD_ID = "capture-receipt-concurrency-household";
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app: App;
let database: Firestore;

describeWithFirestoreEmulator("Capture root receipt concurrent terminal writes", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `${PROJECT_ID}-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(async () => {
    const response = await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error(`Firestore emulator clear failed: ${response.status}`);
  });

  afterAll(async () => { if (app !== undefined) await deleteApp(app); });

  it("동시에 완료한 두 실행은 최초 terminal을 반환하고 늦은 결과나 replay로 TTL을 덮지 않는다", async () => {
    const firstTime = "2026-07-21T01:06:00.000Z";
    const secondTime = "2026-07-22T01:06:00.000Z";
    const firstStore = new FirebaseCaptureSubmissionReceiptStore(database, () => firstTime);
    const secondStore = new FirebaseCaptureSubmissionReceiptStore(database, () => secondTime);
    const envelope: CaptureBranchEnvelope = {
      householdId: HOUSEHOLD_ID,
      rootIdempotencyKey: "shortcut-concurrent-root",
      transactionBranch: {
        branchKey: "shortcut-concurrent-root:payment", merchant: "Synthetic merchant", amountInWon: 12000,
        accountingDate: "2026-07-21", occurredAt: "2026-07-21T10:05:00+09:00", sourceType: "ios-shortcut",
        parser: { parserId: "shortcut-card-message-parser", parserVersion: "1.3.0" },
        rawPayloadHash: `sha256:${"1".repeat(64)}`,
        captureContext: {
          observationId: "shortcut-concurrent-root", observationType: "approval", originChannel: "ios-shortcut",
          creatorMemberId: "member-1", cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
        },
      },
    };
    const payloadFingerprint = new Sha256CapturePayloadFingerprint().fingerprint(envelope);
    const claim = await firstStore.claim({ envelope, payloadFingerprint });
    if (claim.kind === "conflict") throw new Error("initial claim must succeed");
    const completed = (transactionId: string): CaptureSubmissionReceipt => ({
      ...claim.receipt, state: "completed",
      transaction: {
        stage: "terminal", downstreamKey: "shortcut-concurrent-root:payment",
        result: { kind: "recorded", transactionId, captureLineageId: "lineage-1", aggregateVersion: 1, editable: true },
      },
    });
    const firstCandidate = completed("transaction-first");
    const secondCandidate = completed("transaction-second");

    // Both clients start with the same claimed snapshot. Real Firestore must serialize
    // or retry the writes, and save must return the winner rather than its stale input.
    const [firstSaved, secondSaved] = await Promise.all([
      firstStore.save(firstCandidate),
      secondStore.save(secondCandidate),
    ]);
    expect(firstSaved).toEqual(secondSaved);
    expect([firstCandidate, secondCandidate]).toContainEqual(firstSaved);
    const replay = await firstStore.claim({ envelope, payloadFingerprint });
    expect(replay).toEqual({ kind: "existing", receipt: firstSaved });

    const documents = await database.collection("households").doc(HOUSEHOLD_ID).collection("captureSubmissionReceipts").get();
    expect(documents.size).toBe(1);
    const before = documents.docs[0];
    const winnerTime = firstSaved.transaction.stage === "terminal"
      && firstSaved.transaction.result.kind === "recorded"
      && firstSaved.transaction.result.transactionId === "transaction-first" ? firstTime : secondTime;
    expect(before.data().terminalAt).toBe(winnerTime);
    expect((before.data().expiresAt as Timestamp).toDate().getTime())
      .toBe(Date.parse(winnerTime) + 30 * 24 * 60 * 60 * 1000);

    const lateStore = new FirebaseCaptureSubmissionReceiptStore(database, () => "2026-08-01T01:06:00.000Z");
    expect(await lateStore.save(completed("late-replacement"))).toEqual(firstSaved);
    const after = await before.ref.get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
  }, 30_000);
});
