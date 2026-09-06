import type * as firestore from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { describe, expect, it, vi } from "vitest";
import { InMemoryFirestore } from "../../../support/in-memory-firestore";
import { FirebaseDeliveryAssuranceStore, FirebaseDeliveryMembershipQuery, FirebaseFidDeliveryProvider } from "../../../../src/adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";
import { FirebaseNotificationMemberCleanupStore } from "../../../../src/adapters/firebase/notifications/firebaseNotificationMemberCleanupStore";
import { createFirebaseNotificationHouseholdPurgeApplication } from "../../../../src/adapters/firebase/notifications/firebaseNotificationHouseholdPurgeStore";
import { createDeliveryAssuranceApplication } from "../../../../src/contexts/notifications/application/deliveryAssuranceApplication";
import { createNotificationOutboxDispatchApplication } from "../../../../src/contexts/notifications/application/notificationOutboxDispatchApplication";
import { createNotificationTargetPlanner } from "../../../../src/contexts/notifications/public";
import { reconcileInterruptedNotificationDeliveries, FirebaseLegacyShortcutNotificationGuard } from "../../../../src/adapters/firebase/notifications/firebaseNotificationReconciliation";
import { createHash } from "node:crypto";
import { createLedgerHouseholdCommandHandlers } from "../../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import { FirebaseRecurringFinanceUnitOfWork } from "../../../../src/adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork";
import { createRecurringSchedulerWorkflowApplication } from "../../../../src/contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication";

const now = "2026-09-06T01:00:00.000Z";
function setup() {
  const memory = new InMemoryFirestore();
  const database = memory as unknown as firestore.Firestore;
  const endpoint = { householdId: "house", memberId: "member", fid: "fid", platform: "ios-pwa", status: "active", registrationVersion: 1, bindingVersion: 1, deviceInfo: {}, registeredAt: "2026-09-01T00:00:00.000Z", lastConfirmedAt: "2026-09-01T00:00:00.000Z" };
  memory.seed("notificationEndpoints/endpoint", endpoint);
  memory.seed("households/house/members/member", { lifecycleState: "active" });
  const store = new FirebaseDeliveryAssuranceStore(database);
  const send = vi.fn(async (_message: unknown) => "provider-message");
  const membership = new FirebaseDeliveryMembershipQuery(database);
  const delivery = createDeliveryAssuranceApplication(createNotificationTargetPlanner(), membership, store, new FirebaseFidDeliveryProvider({ send } as unknown as Messaging), { now: () => now });
  const memberRemoval = new FirebaseNotificationMemberCleanupStore(database);
  return { memory, database, endpoint, store, send, delivery, membership, dispatcher: createNotificationOutboxDispatchApplication({ delivery, memberRemoval }) };
}
function event(eventType = "TransactionRecorded.v1") {
  return { eventId: `event-${eventType}`, eventType, householdId: "house", occurredAt: now, aggregateId: "transaction", payload: { transactionId: "transaction", creatorMemberId: "member", originChannel: "ios-shortcut" } };
}

describe("Notifications 실제 Outbox dispatch와 Firebase 전달 저장소", () => {
  it.each(["expense", "income", "monthly", "recurring"])("[PUSH-004] 실제 %s 생성 Outbox는 creator/channel을 보존하고 정상 NoTarget으로 끝난다", async (mode) => {
    const subject = setup();
    subject.memory.seed("categories/etc", { householdId: "house", key: "etc", isActive: true });
    if (mode === "recurring") {
      subject.memory.seed("households/house/recurringPlans/plan", {
        householdId: "house", planId: "plan", merchant: "정기", categoryId: "etc",
        amountInWon: 1000, dayOfMonth: 1, creatorMemberId: "member",
        firstApplicableMonth: "2026-09", active: true, lifecycleState: "active", version: 1,
      });
      const application = createRecurringSchedulerWorkflowApplication({
        unitOfWork: new FirebaseRecurringFinanceUnitOfWork(subject.database),
        clock: { now: () => now, localDate: () => "2026-09-06" },
        ids: { transactionId: key => `ledger-${key}`, eventId: (key, type) => `${key}-${type}` },
        events: { async publish() {} },
      });
      expect(await application.processMonth({
        actor: { kind: "system", capabilities: ["recurring.process"] },
        householdId: "house", planId: "plan", targetMonth: "2026-09",
      })).toMatchObject({ kind: "created" });
    } else {
      const command = mode === "monthly" ? "ledger.record-manual-monthly-split.v1" : "ledger.record-manual-transaction.v1";
      await createLedgerHouseholdCommandHandlers(subject.database).get(command)!.execute({
        principalUid: "uid", requestedAt: now,
        actor: { principalUid: "uid", householdId: "house", actingMemberId: "member", capabilities: ["household.write"] },
        envelope: { contractVersion: "household-command.v1", command, commandId: mode, idempotencyKey: mode, householdId: "house", payload: {
          transactionType: mode === "income" ? "income" : "expense", merchant: "수동",
          itemName: "수입", amountInWon: 1000, categoryId: "etc", accountingDate: "2026-09-06",
          ...(mode === "monthly" ? { months: 2 } : {}),
        } },
      });
    }
    const outbox = subject.memory.documentsInCollection("outboxEvents")
      .filter(row => row.value.eventType === "TransactionRecorded");
    expect(outbox.length).toBeGreaterThan(0);
    for (const row of outbox) {
      const payload = row.value.payload as Record<string, unknown>;
      expect(payload).toMatchObject({
        creatorMemberId: "member", originChannel: mode === "recurring" ? "recurring" : mode === "monthly" ? "system" : "web-manual",
      });
      const result = await subject.dispatcher.consume({
        eventId: row.value.eventId as string, eventType: "TransactionRecorded.v1",
        householdId: "house", occurredAt: now, aggregateId: row.value.aggregateId as string, payload,
      });
      expect(result).toMatchObject({ kind: "NoTarget" });
    }
    expect(subject.memory.documentsInCollection("notificationDeliveries")).toEqual([]);
    expect(subject.send).not.toHaveBeenCalled();
  });

  it("[PUSH-013] legacy Inbox 소유를 durable page로 보완하고 근거가 없는 Inbox는 삭제 전에 실패한다", async () => {
    const subject = setup();
    subject.memory.seed("notificationInboxes/legacy", { eventId: "legacy-event", status: "terminal" });
    subject.memory.seed("outboxEvents/legacy-event", { householdId: "house" });
    const actor = { systemRef: "purge", capabilities: ["householdLifecycle:purge" as const] };
    const command = { householdId: "house", processId: "legacy-purge", checkpoint: "START" };
    const application = createFirebaseNotificationHouseholdPurgeApplication(subject.database, 1);
    const page = await application.purgeHouseholdData(actor, command);
    expect(await application.purgeHouseholdData(actor, command)).toEqual(page);
    expect(subject.memory.document("notificationInboxes/legacy")).toMatchObject({ householdId: "house" });
    const unresolved = setup();
    unresolved.memory.seed("notificationInboxes/unresolved", { eventId: "missing-event", status: "terminal" });
    await expect(createFirebaseNotificationHouseholdPurgeApplication(unresolved.database, 1).purgeHouseholdData(actor, command)).rejects.toThrow("NOTIFICATION_LEGACY_OWNERSHIP_UNRESOLVED");
    expect(unresolved.memory.document("notificationInboxes/unresolved")).toEqual({ eventId: "missing-event", status: "terminal" });
    expect(unresolved.memory.documentsInCollection("households/house/notificationPurgeOwnershipReceipts")).toEqual([]);
  });
  it.each(["binding", "member", "preference"])("[PUSH-014] 멤버 확인 중 %s가 바뀌어도 마지막 원자 재검증에서 전송을 막는다", async (change) => {
    const subject = setup();
    const accepted = await subject.delivery.accept({ ...event(), eventType: "TransactionRecorded.v1", producer: "payment-capture.shortcut-ingestion", transactionId: "transaction", creatorMemberId: "member", originChannel: "ios-shortcut" });
    if (accepted.kind !== "Queued") throw new Error("EXPECTED_DELIVERY");
    vi.spyOn(subject.membership, "status").mockImplementation(async () => {
      if (change === "binding") subject.memory.seed("notificationEndpoints/endpoint", { ...subject.endpoint, bindingVersion: 2 });
      if (change === "member") subject.memory.seed("households/house/members/member", { lifecycleState: "removed" });
      if (change === "preference") subject.memory.seed("households/house/notificationRecipientPreferences/member", { pushDelivery: "disabled" });
      return "active";
    });
    await expect(subject.delivery.deliver(accepted.deliveryIds[0])).resolves.toMatchObject({ kind: "StaleTarget" });
    expect(subject.send).not.toHaveBeenCalled();
  });

  it("[PUSH-012] 복구 멤버의 옛 endpoint는 제외하고 제거 이후 재등록 endpoint만 허용한다", async () => {
    const subject = setup();
    subject.memory.seed("households/house/members/member", { lifecycleState: "active", removedAt: "2026-09-05T00:00:00.000Z" });
    expect(await subject.store.listEndpoints("house")).toEqual([]);
    subject.memory.seed("notificationEndpoints/endpoint", { ...subject.endpoint, lastConfirmedAt: "2026-09-06T00:00:00.000Z" });
    expect(await subject.store.listEndpoints("house")).toHaveLength(1);
  });

  it("[PUSH-011] 중단 sending을 terminal과 유한 TTL로 마감하고 runner 재실행에도 provider를 호출하지 않는다", async () => {
    const subject = setup();
    const accepted = await subject.delivery.accept({ ...event(), eventType: "TransactionRecorded.v1", producer: "payment-capture.shortcut-ingestion", transactionId: "transaction", creatorMemberId: "member", originChannel: "ios-shortcut" });
    if (accepted.kind !== "Queued") throw new Error("EXPECTED_DELIVERY");
    const row = subject.memory.documentsInCollection("notificationDeliveries")[0];
    subject.memory.seed(row.path, { ...row.value, status: "sending", providerAttemptCount: 1, providerAttemptStartedAt: "2026-09-06T00:55:00.000Z", createdAt: new Date("2026-09-06T00:55:00.000Z") });
    expect(await reconcileInterruptedNotificationDeliveries(subject.database, now)).toBe(1);
    expect(await reconcileInterruptedNotificationDeliveries(subject.database, now)).toBe(0);
    expect(subject.memory.document(row.path)).toMatchObject({ status: "unknown-provider-outcome", providerAttemptCount: 1, expiresAt: expect.any(Date) });
    expect((await subject.store.readInbox(event().eventId))?.status).toBe("terminal");
    expect(subject.memory.documentsInCollection("outboxEvents")).toHaveLength(1);
    expect(subject.send).not.toHaveBeenCalled();
  });

  it("[PUSH-011] 이전 Shortcut in-progress는 새 delivery로 재전송하지 않고 만료 후 unknown으로 마감한다", async () => {
    const subject = setup();
    const path = `shortcutNotificationInboxes/${createHash("sha256").update(event().eventId).digest("hex")}`;
    subject.memory.seed(path, { eventId: event().eventId, status: "in-progress", createdAt: new Date("2026-09-06T00:59:00.000Z") });
    const guard = new FirebaseLegacyShortcutNotificationGuard(subject.database);
    await expect(guard.completion(event().eventId, "house", now)).rejects.toThrow("SHORTCUT_NOTIFICATION_IN_PROGRESS");
    await expect(guard.completion(event().eventId, "house", "2026-09-06T01:03:00.000Z")).resolves.toBe("failed");
    expect(subject.memory.document(path)).toMatchObject({ householdId: "house", status: "completed", outcome: "unknown-provider-outcome", expiresAt: expect.any(Date) });
    await guard.completion(event().eventId, "house", "2026-09-06T01:04:00.000Z");
    expect(subject.send).not.toHaveBeenCalled();
  });
  it.each(["TransactionRecorded.v1", "CaptureDuplicateObserved.v1"])("[IOS-008][IOS-009][PUSH-004] %s를 실제 provider까지 한 번 전달하고 receipt를 재생한다", async (type) => {
    const subject = setup();
    await expect(subject.dispatcher.consume(event(type))).resolves.toMatchObject({ kind: "Completed", status: "succeeded" });
    await subject.dispatcher.consume(event(type));
    expect(subject.send).toHaveBeenCalledTimes(1);
    expect(subject.send.mock.calls[0][0]).toMatchObject({ fid: "fid", data: { expenseId: "transaction", payloadVersion: "notification-payload.v1" } });
    expect(subject.memory.documentsInCollection("notificationDeliveries")[0].value).toMatchObject({ status: "delivered", providerAttemptCount: 1, householdId: "house" });
  });

  it.each(["binding", "removed", "disabled", "logout"])("[PUSH-012][PUSH-014] 계획 뒤 %s 변경은 provider를 호출하지 않고 stale terminal로 끝난다", async (change) => {
    const subject = setup();
    const accepted = await subject.delivery.accept({ ...event(), eventType: "TransactionRecorded.v1", producer: "payment-capture.shortcut-ingestion", transactionId: "transaction", creatorMemberId: "member", originChannel: "ios-shortcut" });
    expect(accepted.kind).toBe("Queued");
    if (accepted.kind !== "Queued") throw new Error("EXPECTED_DELIVERY");
    if (change === "binding") subject.memory.seed("notificationEndpoints/endpoint", { ...subject.endpoint, bindingVersion: 2, memberId: "other" });
    if (change === "removed") subject.memory.seed("households/house/members/member", { lifecycleState: "removed" });
    if (change === "disabled") subject.memory.seed("households/house/notificationRecipientPreferences/member", { pushDelivery: "disabled" });
    if (change === "logout") subject.memory.remove("notificationEndpoints/endpoint");
    await expect(subject.delivery.deliver(accepted.deliveryIds[0])).resolves.toMatchObject({ kind: "StaleTarget" });
    expect(subject.send).not.toHaveBeenCalled();
    await subject.delivery.deliver(accepted.deliveryIds[0]);
    expect(subject.send).not.toHaveBeenCalled();
  });

  it("[PUSH-010][PUSH-004] 30일 전 Shortcut과 알 수 없는 채널은 provider·delivery 생성 없이 별도 terminal로 남긴다", async () => {
    const subject = setup();
    await expect(subject.dispatcher.consume({ ...event(), occurredAt: "2026-08-01T00:00:00.000Z" })).resolves.toMatchObject({ kind: "ExpiredEvent" });
    await expect(subject.dispatcher.consume({ ...event(), eventId: "unknown", payload: { ...event().payload, originChannel: "future-channel" } })).resolves.toMatchObject({ kind: "ContractFailure", code: "UNKNOWN_ORIGIN_CHANNEL" });
    expect(subject.send).not.toHaveBeenCalled();
    expect(subject.memory.documentsInCollection("notificationDeliveries")).toHaveLength(0);
  });

  it("[PUSH-012] 멤버 제거는 해당 endpoint만 삭제하며 지연 Event 뒤의 새 등록과 terminal 전달은 보존한다", async () => {
    const subject = setup();
    subject.memory.seed("notificationEndpoints/new", { ...subject.endpoint, lastConfirmedAt: "2026-09-06T02:00:00.000Z" });
    subject.memory.seed("notificationEndpoints/other", { ...subject.endpoint, memberId: "other" });
    subject.memory.seed("notificationDeliveries/terminal", { householdId: "house", status: "delivered" });
    const removal = { ...event("HouseholdMemberRemoved.v1"), payload: { memberId: "member" } };
    await subject.dispatcher.consume(removal);
    await subject.dispatcher.consume(removal);
    expect(subject.memory.has("notificationEndpoints/endpoint")).toBe(false);
    expect(subject.memory.has("notificationEndpoints/new")).toBe(true);
    expect(subject.memory.has("notificationEndpoints/other")).toBe(true);
    expect(subject.memory.document("notificationDeliveries/terminal")).toEqual({ householdId: "house", status: "delivered" });
  });

  it("[PUSH-013] 작은 purge page 재생·재시작은 같은 결과이며 다른 가구와 provider를 변경하지 않는다", async () => {
    const subject = setup();
    await subject.dispatcher.consume(event());
    subject.memory.seed("notificationEndpoints/other-house", { ...subject.endpoint, householdId: "other" });
    const actor = { systemRef: "access-purge", capabilities: ["householdLifecycle:purge" as const] };
    const application = createFirebaseNotificationHouseholdPurgeApplication(subject.database, 1);
    let checkpoint = "START";
    for (let page = 0; page < 20; page += 1) {
      const command = { householdId: "house", processId: "purge", checkpoint };
      const result = await application.purgeHouseholdData(actor, command);
      expect(await createFirebaseNotificationHouseholdPurgeApplication(subject.database, 1).purgeHouseholdData(actor, command)).toEqual(result);
      if (result.kind === "PurgeCompleted") break;
      if (result.kind !== "PageProcessed") throw new Error("PURGE_NOT_AUTHORIZED");
      checkpoint = result.nextCheckpoint;
    }
    expect(subject.memory.paths().filter((path) => !path.includes("notificationPurgeReceipts") && /notification(?:Endpoints|Inboxes|Intents|Deliveries)\//.test(path))).toEqual(["notificationEndpoints/other-house"]);
    expect(subject.send).toHaveBeenCalledTimes(1);
  });
});
