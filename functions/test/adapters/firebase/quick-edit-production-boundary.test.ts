import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { describe, expect, it, vi } from "vitest";
import { createLedgerHouseholdCommandHandlers } from "../../../src/bootstrap/commands/ledgerHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext } from "../../../src/bootstrap/commands/householdCommand";
import { FirebaseDeliveryAssuranceStore, FirebaseDeliveryMembershipQuery, FirebaseFidDeliveryProvider } from "../../../src/adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";
import { FirebaseNotificationMemberCleanupStore } from "../../../src/adapters/firebase/notifications/firebaseNotificationMemberCleanupStore";
import { createNotificationOutboxDispatchApplication } from "../../../src/contexts/notifications/application/notificationOutboxDispatchApplication";
import { createDeliveryAssuranceApplication } from "../../../src/contexts/notifications/application/deliveryAssuranceApplication";
import { createNotificationTargetPlanner } from "../../../src/contexts/notifications/public";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const now = "2026-09-06T00:00:00.000Z";
const sourcePath = "households/house/ledgerTransactions/expense";
function setup() {
  const memory = new InMemoryFirestore();
  memory.seed("categories/etc", { householdId: "house", key: "etc", isActive: true });
  memory.seed(sourcePath, {
    householdId: "house", transactionType: "expense", lifecycleState: "active", aggregateVersion: 3,
    merchant: "원본", amountInWon: 10000, categoryId: "etc", memo: "원본 메모",
    accountingDate: "2026-09-06", localTime: "09:00", cardType: "captured", cardDisplay: "KB1234",
    source: "notification", originChannel: "android-notification", creatorMemberId: "creator",
    captureLineageId: "capture-original", cardEvidence: "KB|1234", localCurrencyType: "gyeonggi",
  });
  const database = memory as unknown as Firestore;
  const handlers = createLedgerHouseholdCommandHandlers(database);
  function execute(command: string, payload: Record<string, unknown>, id: string, hasActor = true, requesterMemberId = "requester") {
    return handlers.get(command)!.execute({
      principalUid: "uid", requestedAt: now,
      ...(hasActor ? { actor: { principalUid: "uid", householdId: "house", actingMemberId: requesterMemberId, capabilities: ["household.write"] } } : {}),
      envelope: { contractVersion: "household-command.v1", command, commandId: id, idempotencyKey: id, householdId: "house", payload },
    } as HouseholdCommandExecutionContext);
  }
  return { memory, database, execute };
}
const splitPayload = {
  transactionId: "expense", expectedVersion: 3,
  operation: {
    kind: "items", baseDraft: {
      merchant: "미저장 초안", amountInWon: 12000, categoryId: "etc", memo: "분할 시점 메모",
      creatorMemberId: "forged", cardEvidence: "forged", captureLineageId: "forged",
    },
    items: [
      { merchant: "A", amountInWon: 5000, categoryId: "etc", memo: "A메모" },
      { merchant: "B", amountInWon: 7000, categoryId: "etc", memo: "B메모" },
    ],
  },
};

describe("QuickEdit versioned wire → production Ledger and Notifications adapters", () => {
  it("[QE-003] notify-only ignores unsaved patch, rejects absent requester and fans out to every other active member endpoint", async () => {
    const subject = setup();
    const payload = { transactionId: "expense", expectedVersion: 3, patch: { merchant: "저장 금지", amountInWon: 99000 } };
    const before = subject.memory.document(sourcePath);
    await expect(subject.execute("ledger.request-notification.v1", payload, "no-actor", false)).rejects.toThrow("HOUSEHOLD_FORBIDDEN");
    await expect(subject.execute("ledger.request-notification.v1", payload, "no-requester", true, "")).rejects.toThrow("REQUESTER_MEMBER_REQUIRED");
    expect(subject.memory.document(sourcePath)).toEqual(before);
    expect(subject.memory.documentsInCollection("outboxEvents")).toEqual([]);
    await subject.execute("ledger.request-notification.v1", payload, "notify");
    expect(subject.memory.document(sourcePath)).toMatchObject({ merchant: "원본", amountInWon: 10000, aggregateVersion: 4, notificationRequest: { requesterMemberId: "requester", requestedAt: now } });
    const endpoint = { householdId: "house", status: "active", registrationVersion: 1, bindingVersion: 1, deviceInfo: {}, registeredAt: now, lastConfirmedAt: now };
    for (const [member, platform, suffix] of [["requester", "android", "self"], ["creator", "android", "creator"], ["other", "android", "other-a"], ["other", "ios-pwa", "other-b"], ["removed", "android", "removed"]]) {
      subject.memory.seed(`households/house/members/${member}`, { lifecycleState: member === "removed" ? "removed" : "active" });
      subject.memory.seed(`notificationEndpoints/${suffix}`, { ...endpoint, memberId: member, platform, fid: suffix });
    }
    const send = vi.fn(async () => "provider-accepted");
    const delivery = createDeliveryAssuranceApplication(createNotificationTargetPlanner(), new FirebaseDeliveryMembershipQuery(subject.database), new FirebaseDeliveryAssuranceStore(subject.database), new FirebaseFidDeliveryProvider({ send } as unknown as Messaging), { now: () => now });
    const dispatcher = createNotificationOutboxDispatchApplication({ delivery, memberRemoval: new FirebaseNotificationMemberCleanupStore(subject.database) });
    const event = subject.memory.documentsInCollection("outboxEvents")[0].value;
    const input = { eventId: event.eventId as string, eventType: "HouseholdNotificationRequested.v1", householdId: "house", occurredAt: now, aggregateId: "expense", payload: event.payload as Record<string, unknown> };
    expect(await dispatcher.consume(input)).toMatchObject({ kind: "Completed", status: "succeeded" });
    await dispatcher.consume(input);
    expect(send).toHaveBeenCalledTimes(3);
    expect(subject.memory.documentsInCollection("notificationDeliveries").map(({ value }) => value.recipientMemberId).sort()).toEqual(["creator", "other", "other"]);
  });

  it("[QE-006][QE-010] one draft Split preserves authoritative evidence, supersedes source and replays all children atomically", async () => {
    const subject = setup();
    const result = await subject.execute("ledger.split-transaction.v1", splitPayload, "android:split") as { transactionIds: string[] };
    expect(result.transactionIds).toHaveLength(2);
    expect(subject.memory.document(sourcePath)).toMatchObject({ lifecycleState: "superseded", aggregateVersion: 4, merchant: "미저장 초안", amountInWon: 12000, memo: "분할 시점 메모" });
    for (const id of result.transactionIds) {
      expect(subject.memory.document(`households/house/ledgerTransactions/${id}`)).toMatchObject({
        lifecycleState: "active", cardType: "captured", cardDisplay: "KB1234", transactionType: "expense",
        creatorMemberId: "creator", source: "notification", originChannel: "android-notification",
        captureLineageId: "capture-original", cardEvidence: "KB|1234", localCurrencyType: "gyeonggi", derivedFromTransactionId: "expense",
      });
    }
    expect(subject.memory.documentsInCollection("outboxEvents").filter(row => row.value.eventType === "TransactionRecorded").map(row => row.value.payload)).toEqual(result.transactionIds.map(transactionId => ({ transactionId, originChannel: "system", creatorMemberId: "creator" })));
    const after = subject.memory.documentsInCollection("households/house/ledgerTransactions");
    expect(await subject.execute("ledger.split-transaction.v1", splitPayload, "android:split")).toEqual(result);
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toEqual(after);
  });

  it.each(["stale", "superseded", "deleted", "commit-abort"])("[QE-006][QE-010] %s rejects the full Split without any partial child or source change", async (failure) => {
    const subject = setup();
    const current = subject.memory.document(sourcePath)!;
    if (failure === "stale") subject.memory.seed(sourcePath, { ...current, aggregateVersion: 4 });
    if (failure === "superseded" || failure === "deleted") subject.memory.seed(sourcePath, { ...current, lifecycleState: failure });
    if (failure === "commit-abort") {
      const original = subject.memory.runTransaction.bind(subject.memory);
      vi.spyOn(subject.memory, "runTransaction").mockImplementation(operation => original(async transaction => { await operation(transaction); throw new Error("abort after all writes staged"); }));
    }
    const before = subject.memory.documentsInCollection("households/house/ledgerTransactions");
    await expect(subject.execute("ledger.split-transaction.v1", splitPayload, "rejected")).rejects.toThrow();
    expect(subject.memory.documentsInCollection("households/house/ledgerTransactions")).toEqual(before);
    expect(subject.memory.documentsInCollection("expenses")).toEqual([]);
    expect(subject.memory.documentsInCollection("outboxEvents")).toEqual([]);
    expect(subject.memory.paths().filter(path => path.startsWith("commandReceipts/"))).toEqual([]);
    if (failure === "stale") {
      const latestPayload = { ...splitPayload, expectedVersion: 4 };
      const fresh = await subject.execute("ledger.split-transaction.v1", latestPayload, "fresh-user-command") as { transactionIds: string[] };
      expect(fresh.transactionIds).toHaveLength(2);
    }
  });
});
