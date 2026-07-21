import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  Timestamp,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FirebaseMobileEndpointRegistrationStore } from "../../../src/adapters/firebase/notifications/firebaseMobileEndpointRegistrationStore";
import { FirebaseDeliveryAssuranceStore } from "../../../src/adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";
import { FirebaseScheduledJobExecutionRepository } from "../../../src/adapters/firebase/operations/firebaseScheduledJobStores";

const PROJECT_ID = "demo-household-account-firestore-ttl";
const NOW = "2026-07-21T09:00:00.000Z";
const execFileAsync = promisify(execFile);
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

function endpoint(status: "active" | "inactive") {
  return {
    endpointId: "endpoint-1",
    fid: "fid-1",
    householdId: "household-1",
    memberId: "member-1",
    platform: "android" as const,
    status,
    registrationVersion: 1,
    bindingVersion: 1,
    deviceInfo: {},
    registeredAt: NOW,
    lastConfirmedAt: NOW,
    ...(status === "inactive"
      ? {
          inactiveAt: NOW,
          expiresAt: "2026-08-20T09:00:00.000Z",
        }
      : {}),
  };
}

async function runBackfill(args: readonly string[]) {
  const script = new URL(
    "../../../scripts/backfill-firestore-ttl.mjs",
    import.meta.url,
  );
  const result = await execFileAsync(process.execPath, [fileURLToPath(script), ...args], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: process.env,
  });
  return result.stdout
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describeWithFirestoreEmulator("Firestore TTL adapter boundary", () => {
  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `firestore-ttl-${Date.now()}`);
    database = getFirestore(app);
  });

  beforeEach(clearEmulator);

  afterAll(async () => {
    if (app !== undefined) await deleteApp(app);
  });

  it("inactive endpoint TTL은 Timestamp이고 재활성화하면 과거 TTL을 제거한다", async () => {
    const store = new FirebaseMobileEndpointRegistrationStore(database);
    await store.runForEndpoint("endpoint-1", async (transaction) => {
      await transaction.save(endpoint("inactive"));
    });

    const reference = database.collection("notificationEndpoints").doc("endpoint-1");
    expect((await reference.get()).data()?.expiresAt).toBeInstanceOf(Timestamp);

    await store.runForEndpoint("endpoint-1", async (transaction) => {
      await transaction.save(endpoint("active"));
    });
    expect((await reference.get()).data()).not.toHaveProperty("expiresAt");
    expect((await reference.get()).data()).not.toHaveProperty("inactiveAt");
  });

  it("완료 JobRun만 terminal 기준 Timestamp TTL을 갖고 실패 기록은 보존한다", async () => {
    const repository = new FirebaseScheduledJobExecutionRepository(
      database,
      () => NOW,
    );
    const base = {
      jobName: "daily-job",
      executionKey: "2026-07-21",
      targets: [],
      totals: { target: 0, succeeded: 0, skipped: 0, failed: 0 },
    } as const;
    await repository.saveRun({ runId: "complete", status: "COMPLETE", ...base });
    await repository.saveRun({ runId: "failed", status: "FAILED", ...base });

    const runs = database
      .collection("operations")
      .doc("runtime")
      .collection("scheduledJobRuns");
    expect((await runs.doc("complete").get()).data()?.expiresAt).toBeInstanceOf(
      Timestamp,
    );
    expect((await runs.doc("failed").get()).data()).not.toHaveProperty(
      "expiresAt",
    );
  });

  it("terminal 알림 Inbox·Intent·Delivery는 같은 Domain ISO를 Timestamp로 저장한다", async () => {
    const store = new FirebaseDeliveryAssuranceStore(database);
    const terminalAt = NOW;
    const expiresAt = "2026-08-20T09:00:00.000Z";
    await store.runAcceptance("event-1", async (transaction) => {
      await transaction.saveIntent({
        intentId: "intent-1",
        eventId: "event-1",
        householdId: "household-1",
        status: "terminal",
        terminalAt,
        expiresAt,
      });
      await transaction.saveDeliveries([
        {
          deliveryId: "delivery-1",
          intentId: "intent-1",
          eventId: "event-1",
          householdId: "household-1",
          recipientMemberId: "member-1",
          endpointId: "endpoint-1",
          expectedRegistrationVersion: 1,
          expectedBindingVersion: 1,
          status: "delivered",
          providerAttemptCount: 1,
          terminalAt,
          expiresAt,
        },
      ]);
      await transaction.saveInbox({
        eventId: "event-1",
        status: "terminal",
        intentId: "intent-1",
        deliveryIds: ["delivery-1"],
        terminalAt,
        expiresAt,
      });
    });

    for (const collection of [
      "notificationInboxes",
      "notificationIntents",
      "notificationDeliveries",
    ]) {
      const snapshot = await database.collection(collection).get();
      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0].data().expiresAt).toBeInstanceOf(Timestamp);
    }
    await expect(store.readInbox("event-1")).resolves.toMatchObject({
      terminalAt,
      expiresAt,
    });
  });

  it("dry-run plan hash로 승인된 legacy ISO 문자열만 Timestamp로 변환한다", async () => {
    const reference = database.collection("notificationDeliveries").doc("legacy");
    await reference.set({ expiresAt: "2026-08-20T09:00:00.000Z" });

    const [plan] = await runBackfill([
      "--project",
      PROJECT_ID,
      "--group",
      "notificationDeliveries",
    ]);
    expect(plan).toMatchObject({
      mode: "DRY_RUN",
      projectId: PROJECT_ID,
      convertibleCount: 1,
      invalidCount: 0,
    });
    expect(typeof plan.planHash).toBe("string");
    expect((await reference.get()).data()?.expiresAt).toBe(
      "2026-08-20T09:00:00.000Z",
    );

    await runBackfill([
      "--project",
      PROJECT_ID,
      "--group",
      "notificationDeliveries",
      "--apply",
      "--confirm-project",
      PROJECT_ID,
      "--expected-plan-hash",
      String(plan.planHash),
    ]);
    expect((await reference.get()).data()?.expiresAt).toBeInstanceOf(Timestamp);
  }, 30_000);
});
