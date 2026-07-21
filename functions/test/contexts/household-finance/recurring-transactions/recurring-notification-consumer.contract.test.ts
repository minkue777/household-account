import { describe, expect, it } from "vitest";
import type {
  EndpointFact,
  MemberFact,
} from "../../../../src/contexts/notifications/public";
import {
  createRecurringNotificationConsumerFixtureSubject,
  type NotificationConsumerResult as FixtureNotificationConsumerResult,
  type RecurringNotificationConsumerFixtureSubject,
  type RecurringNotificationEvent as FixtureRecurringNotificationEvent,
  type RecurringNotificationSnapshot as FixtureRecurringNotificationSnapshot,
} from "../../../support/recurring-notification-consumer-driver";

export type RecurringNotificationEvent = FixtureRecurringNotificationEvent;
export type NotificationConsumerResult = FixtureNotificationConsumerResult;
export type RecurringNotificationSnapshot =
  FixtureRecurringNotificationSnapshot;

/** Ledger의 확정 Event와 Notifications consumer가 공유하는 공개 계약입니다. */
export interface RecurringNotificationConsumerSubject
  extends RecurringNotificationConsumerFixtureSubject {}

export function createSubject(
  fixture: {
    members?: readonly MemberFact[];
    endpoints?: readonly EndpointFact[];
  } = {},
): RecurringNotificationConsumerSubject {
  return createRecurringNotificationConsumerFixtureSubject(fixture);
}

describe("정기 거래 Event와 알림 consumer 공개 계약", () => {
  it("[T-REC-PUSH-001][REC-004] recurring 거래 Event는 creator를 보존하지만 일반 새 지출 푸시를 만들지 않는다", async () => {
    const subject = createSubject();
    const processed = await subject.processRecurringMonth({
      planId: "plan-1",
      targetMonth: "2026-07",
    });
    const events = await subject.publishedEvents();
    const transactionEvent = events.find(
      ({ eventType }) => eventType === "TransactionRecorded.v1",
    );
    if (!transactionEvent) {
      throw new Error("TransactionRecorded.v1 Event가 없습니다.");
    }

    const result = await subject.consumeEvent(transactionEvent.eventId);

    expect(processed).toEqual({
      kind: "success",
      transactionId: transactionEvent.transactionId,
    });
    expect(transactionEvent).toEqual({
      eventType: "TransactionRecorded.v1",
      eventId: expect.any(String),
      householdId: "house-1",
      transactionId: processed.transactionId,
      source: "recurring",
      originChannel: "recurring",
      creatorMemberId: "member-plan-creator",
    });
    expect(result).toEqual({
      kind: "no-target",
      reason: "AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL",
      eventId: transactionEvent.eventId,
    });
    const state = await subject.snapshot();
    expect(state.ledgerTransactions).toEqual([
      {
        transactionId: processed.transactionId,
        source: "recurring",
        creatorMemberId: "member-plan-creator",
      },
    ]);
    expect(state.notificationIntents).toEqual([]);
    expect(state.notificationDeliveries).toEqual([]);
  });

  it("[T-REC-PUSH-001][REC-004] 별도의 명시적 알림 요청 Event만 요청자를 제외한 수신 intent를 만든다", async () => {
    const subject = createSubject();
    const processed = await subject.processRecurringMonth({
      planId: "plan-1",
      targetMonth: "2026-07",
    });
    const transactionEvent = (await subject.publishedEvents()).find(
      ({ eventType }) => eventType === "TransactionRecorded.v1",
    );
    if (!transactionEvent) {
      throw new Error("TransactionRecorded.v1 Event가 없습니다.");
    }
    await subject.consumeEvent(transactionEvent.eventId);

    const requested = await subject.requestHouseholdNotification({
      transactionId: processed.transactionId,
      requesterMemberId: "member-requester",
    });
    const result = await subject.consumeEvent(requested.eventId);

    expect(result).toEqual({
      kind: "queued",
      eventId: requested.eventId,
      recipientMemberIds: ["member-plan-creator"],
    });
    const state = await subject.snapshot();
    expect(state.notificationIntents).toEqual([
      {
        sourceEventId: requested.eventId,
        recipientMemberIds: ["member-plan-creator"],
      },
    ]);
    expect(state.notificationDeliveries).toEqual([
      {
        recipientMemberId: "member-plan-creator",
        endpointId: "creator-mobile-endpoint",
      },
    ]);
    expect(await subject.publishedEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "HouseholdNotificationRequested.v1",
          eventId: requested.eventId,
          transactionId: processed.transactionId,
          requesterMemberId: "member-requester",
        }),
      ]),
    );
  });

  it("[T-PUSH-001][PUSH-004] Android에서 등록된 지출은 본인 Quick Edit만 표시하고 푸시 intent를 만들지 않는다", async () => {
    const subject = createSubject();
    const recorded = await subject.recordCapturedTransaction({
      transactionId: "android-expense-1",
      originChannel: "android-notification",
      creatorMemberId: "member-plan-creator",
    });

    await expect(subject.consumeEvent(recorded.eventId)).resolves.toEqual({
      kind: "no-target",
      reason: "ANDROID_USES_QUICK_EDIT",
      eventId: recorded.eventId,
    });
    expect(await subject.publishedEvents()).toContainEqual({
      eventType: "TransactionRecorded.v1",
      eventId: recorded.eventId,
      householdId: "house-1",
      transactionId: "android-expense-1",
      originChannel: "android-notification",
      creatorMemberId: "member-plan-creator",
    });
    const state = await subject.snapshot();
    expect(state.localQuickEdits).toEqual([
      {
        transactionId: "android-expense-1",
        creatorMemberId: "member-plan-creator",
        status: "shown",
      },
    ]);
    expect(state.notificationIntents).toEqual([]);
    expect(state.notificationDeliveries).toEqual([]);
  });

  it("[T-IOS-NOTIFY-001][PUSH-004] iPhone cloud 등록 지출은 생성자 본인의 활성 iPhone endpoint에만 알린다", async () => {
    const members: readonly MemberFact[] = [
      { householdId: "house-1", memberId: "member-creator", status: "active" },
      { householdId: "house-1", memberId: "member-other", status: "active" },
    ];
    const endpoints: readonly EndpointFact[] = [
      {
        endpointId: "creator-ios-a",
        householdId: "house-1",
        memberId: "member-creator",
        platform: "ios-pwa",
        status: "active",
      },
      {
        endpointId: "creator-ios-b",
        householdId: "house-1",
        memberId: "member-creator",
        platform: "ios-pwa",
        status: "active",
      },
      {
        endpointId: "creator-android",
        householdId: "house-1",
        memberId: "member-creator",
        platform: "android",
        status: "active",
      },
      {
        endpointId: "other-ios",
        householdId: "house-1",
        memberId: "member-other",
        platform: "ios-pwa",
        status: "active",
      },
    ];
    const subject = createSubject({ members, endpoints });
    const recorded = await subject.recordCapturedTransaction({
      transactionId: "ios-expense-1",
      originChannel: "ios-shortcut",
      creatorMemberId: "member-creator",
    });

    await expect(subject.consumeEvent(recorded.eventId)).resolves.toEqual({
      kind: "queued",
      eventId: recorded.eventId,
      recipientMemberIds: ["member-creator"],
    });
    const state = await subject.snapshot();
    expect(state.localQuickEdits).toEqual([]);
    expect(state.notificationIntents).toEqual([
      {
        sourceEventId: recorded.eventId,
        recipientMemberIds: ["member-creator"],
      },
    ]);
    expect(state.notificationDeliveries).toEqual([
      { recipientMemberId: "member-creator", endpointId: "creator-ios-a" },
      { recipientMemberId: "member-creator", endpointId: "creator-ios-b" },
    ]);
  });

  it("[T-PUSH-005][PUSH-005] 명시적 알림은 거래 생성자가 아니라 현재 요청자만 제외하고 다른 활성 가구원의 모든 모바일 endpoint로 보낸다", async () => {
    const members: readonly MemberFact[] = [
      { householdId: "house-1", memberId: "member-creator", status: "active" },
      { householdId: "house-1", memberId: "member-requester", status: "active" },
      { householdId: "house-1", memberId: "member-third", status: "active" },
      { householdId: "house-1", memberId: "member-removed", status: "removed" },
      { householdId: "house-2", memberId: "member-other-house", status: "active" },
    ];
    const endpoints: readonly EndpointFact[] = [
      {
        endpointId: "creator-ios",
        householdId: "house-1",
        memberId: "member-creator",
        platform: "ios-pwa",
        status: "active",
      },
      {
        endpointId: "requester-android",
        householdId: "house-1",
        memberId: "member-requester",
        platform: "android",
        status: "active",
      },
      {
        endpointId: "requester-ios",
        householdId: "house-1",
        memberId: "member-requester",
        platform: "ios-pwa",
        status: "active",
      },
      {
        endpointId: "third-android",
        householdId: "house-1",
        memberId: "member-third",
        platform: "android",
        status: "active",
      },
      {
        endpointId: "third-ios",
        householdId: "house-1",
        memberId: "member-third",
        platform: "ios-pwa",
        status: "active",
      },
      {
        endpointId: "removed-ios",
        householdId: "house-1",
        memberId: "member-removed",
        platform: "ios-pwa",
        status: "active",
      },
      {
        endpointId: "other-house-ios",
        householdId: "house-2",
        memberId: "member-other-house",
        platform: "ios-pwa",
        status: "active",
      },
    ];
    const subject = createSubject({ members, endpoints });
    const recorded = await subject.recordCapturedTransaction({
      transactionId: "explicit-expense-1",
      originChannel: "android-notification",
      creatorMemberId: "member-creator",
    });
    await subject.consumeEvent(recorded.eventId);
    const requested = await subject.requestHouseholdNotification({
      transactionId: "explicit-expense-1",
      requesterMemberId: "member-requester",
    });

    await expect(subject.consumeEvent(requested.eventId)).resolves.toEqual({
      kind: "queued",
      eventId: requested.eventId,
      recipientMemberIds: ["member-creator", "member-third"],
    });
    expect((await subject.snapshot()).notificationDeliveries).toEqual([
      { recipientMemberId: "member-creator", endpointId: "creator-ios" },
      { recipientMemberId: "member-third", endpointId: "third-android" },
      { recipientMemberId: "member-third", endpointId: "third-ios" },
    ]);
  });

  it("[T-REC-PUSH-001][PUSH-003] 같은 Event를 다시 소비해도 intent와 delivery를 중복 생성하지 않는다", async () => {
    const subject = createSubject();
    const processed = await subject.processRecurringMonth({
      planId: "plan-1",
      targetMonth: "2026-07",
    });
    const requested = await subject.requestHouseholdNotification({
      transactionId: processed.transactionId,
      requesterMemberId: "member-requester",
    });

    await expect(subject.consumeEvent(requested.eventId)).resolves.toMatchObject({
      kind: "queued",
    });
    await expect(subject.consumeEvent(requested.eventId)).resolves.toEqual({
      kind: "already-processed",
      eventId: requested.eventId,
    });
    const state = await subject.snapshot();
    expect(state.notificationIntents).toHaveLength(1);
    expect(state.notificationDeliveries).toHaveLength(1);
  });
});
