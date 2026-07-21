import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FirebaseDiagnosticDocumentStore } from "../../../src/adapters/firebase/payment-capture/firebaseDiagnosticDocumentStore";
import { FirebaseCaptureMembershipResolver } from "../../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import { createNotificationDiagnosticCallableHandler } from "../../../src/bootstrap/firebaseNotificationDiagnostic";
import { createDiagnosticRetentionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/diagnosticRetentionApplication";

const PROJECT_ID = "demo-household-account-diagnostics";
const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

let app: App;
let database: Firestore;

async function clearEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host === undefined) return;
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Firestore emulator clear failed: ${response.status}`);
  }
}

function payload() {
  return {
    packageName: "com.kbcard.cxh.appcard",
    title: "승인",
    text: "12,000원",
    bigText: "KB국민카드 승인 12,000원",
    textLines: ["KB국민카드", "12,000원"],
    fullText: "승인\nKB국민카드 승인 12,000원",
    postedAtMillis: 1_768_879_800_000,
  };
}

describeWithFirestoreEmulator("Firebase notification diagnostic adapter", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `diagnostics-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(clearEmulator);

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("활성 membership을 서버에서 해석하고 동일 원문도 TTL 없이 각각 보존한다", async () => {
    const principalUid = "diagnostic-user";
    const householdId = "diagnostic-household";
    const memberId = "diagnostic-member";
    const household = database.collection("households").doc(householdId);
    await Promise.all([
      household.set({ lifecycleState: "active" }),
      household
        .collection("memberships")
        .doc(principalUid)
        .set({ lifecycleState: "active", householdId, memberId }),
      household
        .collection("members")
        .doc(memberId)
        .set({ lifecycleState: "active", displayName: "진단 사용자" }),
      database
        .collection("users")
        .doc(principalUid)
        .collection("householdMembershipViews")
        .doc(householdId)
        .set({ lifecycleState: "active", householdId, memberId }),
    ]);

    const handler = createNotificationDiagnosticCallableHandler({
      memberships: new FirebaseCaptureMembershipResolver(database),
      diagnostics: createDiagnosticRetentionApplication(
        new FirebaseDiagnosticDocumentStore(database),
      ),
      now: () => "2026-07-21T01:02:03.000Z",
    });

    const first = await handler.handle({ principalUid, data: payload() });
    const second = await handler.handle({ principalUid, data: payload() });
    expect(first.result.kind).toBe("Collected");
    expect(second.result.kind).toBe("Collected");

    const logs = await database.collection("notification_debug_logs").get();
    expect(logs.size).toBe(2);
    expect(logs.docs[0].id).not.toBe(logs.docs[1].id);
    for (const document of logs.docs) {
      expect(document.data()).toMatchObject({
        householdId,
        memberId,
        packageName: "com.kbcard.cxh.appcard",
        source: "kb-card",
        sourceType: "kb-card",
        postedAtMillis: 1_768_879_800_000,
        collectedAt: "2026-07-21T01:02:03.000Z",
      });
      expect(document.data()).toHaveProperty("createdAt");
      expect(document.data()).not.toHaveProperty("expiresAt");
      expect(document.data()).not.toHaveProperty("authToken");
      expect(document.data()).not.toHaveProperty("fcmFid");
      expect(document.data()).not.toHaveProperty("householdAccessKey");
    }
  });

  it("인증되지 않은 요청은 진단 컬렉션을 만들지 않는다", async () => {
    const handler = createNotificationDiagnosticCallableHandler({
      memberships: new FirebaseCaptureMembershipResolver(database),
      diagnostics: createDiagnosticRetentionApplication(
        new FirebaseDiagnosticDocumentStore(database),
      ),
    });

    await expect(handler.handle({ data: payload() })).rejects.toMatchObject({
      callableCode: "unauthenticated",
      domainCode: "AUTH_REQUIRED",
    });
    expect((await database.collection("notification_debug_logs").get()).empty).toBe(
      true,
    );
  });
});
