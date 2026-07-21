import { describe, expect, it } from "vitest";
import {
  createNotificationTargetPlanner,
  type EndpointFact,
  type MemberFact,
  type NotificationTargetDecision,
  type NotificationTargetPlanner,
  type TransactionRecordedNotificationInput,
} from "../../../src/contexts/notifications/public";

export interface NotificationTargetPolicyContractSubject
  extends NotificationTargetPlanner {}

export function createSubject(): NotificationTargetPolicyContractSubject {
  return createNotificationTargetPlanner();
}

const members: readonly MemberFact[] = [
  { householdId: "house-1", memberId: "member-requester", status: "active" },
  { householdId: "house-1", memberId: "member-creator", status: "active" },
  { householdId: "house-1", memberId: "member-third", status: "active" },
  { householdId: "house-1", memberId: "member-removed", status: "removed" },
  { householdId: "house-2", memberId: "member-other-house", status: "active" },
];

const endpoints: readonly EndpointFact[] = [
  { endpointId: "requester-android", householdId: "house-1", memberId: "member-requester", platform: "android", status: "active" },
  { endpointId: "requester-ios", householdId: "house-1", memberId: "member-requester", platform: "ios-pwa", status: "active" },
  { endpointId: "creator-ios-a", householdId: "house-1", memberId: "member-creator", platform: "ios-pwa", status: "active" },
  { endpointId: "creator-ios-b", householdId: "house-1", memberId: "member-creator", platform: "ios-pwa", status: "active" },
  { endpointId: "creator-android", householdId: "house-1", memberId: "member-creator", platform: "android", status: "active" },
  { endpointId: "creator-inactive", householdId: "house-1", memberId: "member-creator", platform: "ios-pwa", status: "inactive" },
  { endpointId: "third-android", householdId: "house-1", memberId: "member-third", platform: "android", status: "active" },
  { endpointId: "removed-ios", householdId: "house-1", memberId: "member-removed", platform: "ios-pwa", status: "active" },
  { endpointId: "other-house-ios", householdId: "house-2", memberId: "member-other-house", platform: "ios-pwa", status: "active" },
];

const transactionInput = (
  overrides: Partial<TransactionRecordedNotificationInput> = {},
): TransactionRecordedNotificationInput => ({
  eventId: "event-transaction-1",
  householdId: "house-1",
  transactionId: "expense-1",
  transactionType: "expense",
  originChannel: "android-notification",
  creatorMemberId: "member-creator",
  members,
  endpoints,
  ...overrides,
});

const targetIds = (decision: NotificationTargetDecision): readonly string[] =>
  decision.kind === "Recipients"
    ? decision.targets.map((target) => target.endpointId).sort()
    : [];

describe("거래 알림 수신 대상 공개 계약", () => {
  it("[T-PUSH-001/T-PUSH-005][PUSH-004][DEC-013] Android 알림으로 등록한 지출은 생성자와 다른 가구원 모두에게 자동 푸시를 만들지 않는다", () => {
    const result = createSubject().forRecordedTransaction(
      transactionInput({ originChannel: "android-notification" }),
    );

    expect(result).toEqual({ kind: "NoTarget", reason: "ANDROID_USES_QUICK_EDIT" });
  });

  it("[T-IOS-NOTIFY-001/T-PUSH-001/T-PUSH-005][PUSH-004][DEC-013/DEC-020] iPhone Shortcut 지출은 생성자의 모든 활성 iPhone PWA endpoint에만 편집 푸시를 만든다", () => {
    const result = createSubject().forRecordedTransaction(
      transactionInput({ originChannel: "ios-shortcut" }),
    );

    expect(targetIds(result)).toEqual(["creator-ios-a", "creator-ios-b"]);
    if (result.kind === "Recipients") {
      expect(result.targets).toHaveLength(2);
      expect(result.targets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recipientMemberId: "member-creator",
            platform: "ios-pwa",
            payload: {
              payloadVersion: "notification-payload.v1",
              type: "expense-created",
              clickTarget: "expense-edit",
              expenseId: "expense-1",
            },
          }),
        ]),
      );
    }
  });

  it.each(["web-manual", "recurring", "system"])(
    "[T-PUSH-002/T-PUSH-005][PUSH-004][DEC-013] %s 거래는 저장만 하고 자동 푸시를 만들지 않는다",
    (originChannel) => {
      const result = createSubject().forRecordedTransaction(
        transactionInput({ originChannel }),
      );

      expect(result).toEqual({
        kind: "NoTarget",
        reason: "AUTO_PUSH_NOT_ALLOWED_FOR_CHANNEL",
      });
    },
  );

  it("[T-PUSH-005][PUSH-004] 알 수 없는 originChannel은 조용한 무알림 성공이 아니라 생산자 계약 오류다", () => {
    const result = createSubject().forRecordedTransaction(
      transactionInput({ originChannel: "future-channel" }),
    );

    expect(result).toEqual({ kind: "ContractFailure", code: "UNKNOWN_ORIGIN_CHANNEL" });
  });

  it("[T-PUSH-001][PUSH-004][DEC-013] creator 누락은 알림을 생략하는 우회 조건이 아니라 Event 계약 오류다", () => {
    const result = createSubject().forRecordedTransaction(
      transactionInput({ originChannel: "ios-shortcut", creatorMemberId: undefined }),
    );

    expect(result).toEqual({ kind: "ContractFailure", code: "CREATOR_MEMBER_REQUIRED" });
  });

  it("[T-PUSH-005][PUSH-005][DEC-013/DEC-022] 명시적 알림 요청은 creator가 아니라 requester만 제외하고 다른 활성 멤버의 모든 활성 모바일 endpoint로 fan-out한다", () => {
    const result = createSubject().forExplicitHouseholdRequest({
      eventId: "event-explicit-1",
      householdId: "house-1",
      transactionId: "expense-1",
      creatorMemberId: "member-creator",
      requesterMemberId: "member-requester",
      members,
      endpoints,
    });

    expect(targetIds(result)).toEqual([
      "creator-android",
      "creator-ios-a",
      "creator-ios-b",
      "third-android",
    ]);
    expect(targetIds(result)).not.toContain("other-house-ios");
    if (result.kind === "Recipients") {
      expect(
        result.targets.every((target) =>
          endpoints.some(
            (endpoint) =>
              endpoint.endpointId === target.endpointId &&
              endpoint.householdId === "house-1",
          ),
        ),
      ).toBe(true);
      expect(result.targets.every((target) => target.recipientMemberId !== "member-requester")).toBe(true);
      expect(result.targets.every((target) => target.recipientMemberId !== "member-removed")).toBe(true);
      expect(result.targets.every((target) => target.payload.type === "household-notification-requested")).toBe(true);
    }
  });

  it("[T-PUSH-005][PUSH-005] 요청자 외 활성 가구원이 없으면 first-match 대상을 만들지 않고 NoTarget이다", () => {
    const result = createSubject().forExplicitHouseholdRequest({
      eventId: "event-explicit-alone",
      householdId: "house-1",
      transactionId: "expense-1",
      creatorMemberId: "member-requester",
      requesterMemberId: "member-requester",
      members: [
        {
          householdId: "house-1",
          memberId: "member-requester",
          status: "active",
        },
      ],
      endpoints: [endpoints[0]],
    });

    expect(result).toEqual({ kind: "NoTarget", reason: "NO_OTHER_HOUSEHOLD_MEMBER" });
  });

  it("[T-PUSH-005][PUSH-005] 다른 활성 가구원이 있어도 활성 모바일 endpoint가 하나도 없으면 NoTarget이다", () => {
    const result = createSubject().forExplicitHouseholdRequest({
      eventId: "event-explicit-no-endpoint",
      householdId: "house-1",
      transactionId: "expense-1",
      creatorMemberId: "member-creator",
      requesterMemberId: "member-requester",
      members: [members[0], members[1]],
      endpoints: [endpoints[0], { ...endpoints[2], status: "inactive" }],
    });

    expect(result).toEqual({ kind: "NoTarget", reason: "NO_ACTIVE_ENDPOINT" });
  });

  it("[T-PUSH-005][PUSH-005] requester가 없는 명시적 요청은 누구도 임의 제외하지 않고 계약 오류로 끝난다", () => {
    const result = createSubject().forExplicitHouseholdRequest({
      eventId: "event-explicit-no-requester",
      householdId: "house-1",
      transactionId: "expense-1",
      creatorMemberId: "member-creator",
      requesterMemberId: undefined,
      members,
      endpoints,
    });

    expect(result).toEqual({ kind: "ContractFailure", code: "REQUESTER_MEMBER_REQUIRED" });
  });
});
