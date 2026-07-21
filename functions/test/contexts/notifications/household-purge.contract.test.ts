import { describe, expect, it } from "vitest";
import type {
  LifecycleSignalResult as PublicLifecycleSignalResult,
  NotificationHouseholdPurgeInputPort,
  NotificationPurgePageResult as PublicNotificationPurgePageResult,
  NotificationPurgeSystemActor as PublicNotificationPurgeSystemActor,
} from "../../../src/contexts/notifications/public";
import {
  createNotificationHouseholdPurgeFixtureSubject,
  type NotificationOwnedRecord as FixtureNotificationOwnedRecord,
  type NotificationPurgeSnapshot as FixtureNotificationPurgeSnapshot,
} from "../../support/notification-household-purge-driver";

export type NotificationPurgeSystemActor = PublicNotificationPurgeSystemActor;

export type NotificationOwnedRecord = FixtureNotificationOwnedRecord;

export type NotificationPurgePageResult =
  PublicNotificationPurgePageResult;

export type LifecycleSignalResult =
  PublicLifecycleSignalResult;

export type NotificationPurgeSnapshot = FixtureNotificationPurgeSnapshot;

/** Notifications가 Access 영구 purge에 제공하는 paged Context lifecycle Port입니다. */
export interface NotificationHouseholdPurgeContractSubject
  extends NotificationHouseholdPurgeInputPort {
  snapshot(): Promise<NotificationPurgeSnapshot>;
}

export function createSubject(_fixture: {
  pageSize: number;
  records: readonly NotificationOwnedRecord[];
  providerCalls?: NotificationPurgeSnapshot["providerCalls"];
}): NotificationHouseholdPurgeContractSubject {
  return createNotificationHouseholdPurgeFixtureSubject(_fixture);
}

const targetRecords: readonly NotificationOwnedRecord[] = [
  { recordId: "endpoint-a", householdId: "house-target", kind: "endpoint" },
  { recordId: "intent-a", householdId: "house-target", kind: "intent" },
  { recordId: "delivery-a", householdId: "house-target", kind: "delivery" },
  { recordId: "inbox-a", householdId: "house-target", kind: "inbox" },
];

const otherHouseholdRecords: readonly NotificationOwnedRecord[] = [
  { recordId: "endpoint-b", householdId: "house-other", kind: "endpoint" },
  { recordId: "intent-b", householdId: "house-other", kind: "intent" },
  { recordId: "delivery-b", householdId: "house-other", kind: "delivery" },
  { recordId: "inbox-b", householdId: "house-other", kind: "inbox" },
];

const purgeSystem: NotificationPurgeSystemActor = {
  systemRef: "access-household-purge-runner",
  capabilities: ["householdLifecycle:purge"],
};

describe("Notifications 가구 데이터 paged purge 공개 계약", () => {
  it("[T-PUSH-PURGE-001][PUSH-013/ADM-003] 논리 삭제 Event는 purge를 시작하지 않고 모든 알림 상태를 보존한다", async () => {
    const subject = createSubject({
      pageSize: 2,
      records: [...targetRecords, ...otherHouseholdRecords],
    });
    const before = await subject.snapshot();

    await expect(
      subject.handleHouseholdLifecycleSignal({
        eventType: "HouseholdDeleted.v1",
        householdId: "house-target",
      }),
    ).resolves.toEqual({
      kind: "Ignored",
      reason: "LOGICAL_DELETE_DOES_NOT_PURGE",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-PUSH-PURGE-001][PUSH-013/ADM-003/DEC-040] 영구 purge 요청 신호만으로는 데이터를 지우지 않고 승인된 process를 대기한다", async () => {
    const subject = createSubject({
      pageSize: 2,
      records: [...targetRecords, ...otherHouseholdRecords],
    });
    const before = await subject.snapshot();

    await expect(
      subject.handleHouseholdLifecycleSignal({
        eventType: "HouseholdPermanentPurgeRequested.v1",
        householdId: "house-target",
        processId: "purge-awaiting-system-command",
      }),
    ).resolves.toEqual({
      kind: "AcceptedForPurge",
      processId: "purge-awaiting-system-command",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-PUSH-PURGE-001][PUSH-013/DEC-040] 승인되지 않은 actor는 endpoint·Intent·Delivery·Inbox를 한 건도 읽어 지우지 않는다", async () => {
    const subject = createSubject({
      pageSize: 2,
      records: [...targetRecords, ...otherHouseholdRecords],
    });
    const before = await subject.snapshot();

    await expect(
      subject.purgeHouseholdData(
        { systemRef: "ordinary-request", capabilities: [] },
        {
          householdId: "house-target",
          processId: "purge-1",
          checkpoint: "START",
        },
      ),
    ).resolves.toEqual({
      kind: "Forbidden",
      code: "PURGE_SYSTEM_CAPABILITY_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
  });

  it("[T-PUSH-PURGE-001][PUSH-013/DEC-040] 같은 processId·checkpoint의 순차·동시 재전달은 같은 page 결과를 재생하고 receipt 하나만 만든다", async () => {
    const subject = createSubject({
      pageSize: 2,
      records: [...targetRecords, ...otherHouseholdRecords],
    });
    const input = {
      householdId: "house-target",
      processId: "purge-replayed-page",
      checkpoint: "START",
    };

    const [first, concurrentReplay] = await Promise.all([
      subject.purgeHouseholdData(purgeSystem, input),
      subject.purgeHouseholdData(purgeSystem, input),
    ]);
    const sequentialReplay = await subject.purgeHouseholdData(
      purgeSystem,
      input,
    );

    expect(first).toEqual(
      expect.objectContaining({
        kind: "PageProcessed",
        processId: input.processId,
        checkpoint: "START",
        deletedCount: 2,
      }),
    );
    expect(concurrentReplay).toEqual(first);
    expect(sequentialReplay).toEqual(first);
    const state = await subject.snapshot();
    expect(
      state.pageReceipts.filter(
        ({ processId, checkpoint }) =>
          processId === input.processId && checkpoint === "START",
      ),
    ).toHaveLength(1);
    expect(
      state.records.filter(({ householdId }) => householdId === "house-target"),
    ).toHaveLength(2);
    expect(
      state.records.filter(({ householdId }) => householdId === "house-other"),
    ).toEqual(otherHouseholdRecords);
  });

  it("[T-PUSH-PURGE-001][PUSH-013/DEC-040] page를 끝까지 처리하면 대상 가구 상태만 제거하고 타 가구와 기존 provider side effect를 유지한다", async () => {
    const existingProviderCalls = [
      { deliveryId: "delivery-already-sent", endpointId: "endpoint-a" },
    ] as const;
    const subject = createSubject({
      pageSize: 2,
      records: [...targetRecords, ...otherHouseholdRecords],
      providerCalls: existingProviderCalls,
    });
    const processId = "purge-complete";
    let checkpoint = "START";
    let completed = false;

    while (!completed) {
      const result = await subject.purgeHouseholdData(purgeSystem, {
        householdId: "house-target",
        processId,
        checkpoint,
      });
      if (result.kind === "Forbidden") {
        throw new Error("승인된 purge process가 권한 오류로 중단됐습니다.");
      }
      if (result.kind === "PageProcessed") {
        checkpoint = result.nextCheckpoint;
      } else if (result.kind === "PurgeCompleted") {
        completed = true;
      }
    }

    const state = await subject.snapshot();
    expect(
      state.records.filter(({ householdId }) => householdId === "house-target"),
    ).toEqual([]);
    expect(
      state.records.filter(({ householdId }) => householdId === "house-other"),
    ).toEqual(otherHouseholdRecords);
    expect(state.providerCalls).toEqual(existingProviderCalls);
    expect(
      state.pageReceipts.filter(({ processId: receiptProcessId }) =>
        receiptProcessId === processId,
      ).length,
    ).toBeGreaterThan(0);
  });
});
