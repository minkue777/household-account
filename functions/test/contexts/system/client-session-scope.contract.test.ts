import { describe, expect, it } from "vitest";
import type { ClientSessionScopeInputPort } from "../../../src/platform/client-session/public";
import { createClientSessionScopeFixture } from "../../support/client-session-scope-fixture";

export interface ClientSessionScopeContractSubject
  extends ClientSessionScopeInputPort {}

export function createSubject(): ClientSessionScopeContractSubject {
  return createClientSessionScopeFixture();
}

describe("Client SessionScope 격리 계약", () => {
  it.each([
    "protected-query",
    "initialize-default-categories",
    "register-endpoint",
  ] as const)(
    "[T-SYS-008][SYS-008] 인증과 유일 Membership 확인 전에는 %s를 시작하지 않는다",
    (operation) => {
      const subject = createSubject();
      expect(subject.attemptBeforeMembership(operation)).toEqual({
        kind: "blocked",
        code: "AUTHENTICATED_MEMBERSHIP_REQUIRED",
      });
      expect(subject.state()).toEqual({
        cachedKeys: [],
        activeSubscriptions: [],
        renderedRecordIds: [],
        writes: [],
        externalEffects: [],
      });
    },
  );

  it("[T-SYS-008][SYS-008] A에서 B로 전환하면 A cache·구독을 폐기하고 늦은 A callback을 버린다", () => {
    const subject = createSubject();
    const scopeA = subject.establish({
      principalUid: "uid-a",
      householdId: "house-a",
      memberId: "member-a",
    });
    const queryA = subject.beginQuery("ledger:2026-07");
    const subscriptionA = subject.subscribe("ledger-live");
    const scopeB = subject.establish({
      principalUid: "uid-b",
      householdId: "house-b",
      memberId: "member-b",
    });

    expect(subject.receiveQuery({ token: queryA, recordIds: ["a-secret"] })).toBe(
      "discarded",
    );
    expect(
      subject.receiveSubscription({
        subscriptionId: subscriptionA.subscriptionId,
        scope: scopeA,
        recordIds: ["a-secret"],
      }),
    ).toBe("discarded");
    expect(subject.state()).toMatchObject({
      scope: scopeB,
      cachedKeys: [],
      activeSubscriptions: [],
      renderedRecordIds: [],
    });
  });

  it("[T-SYS-008][SYS-008] 이전 세대 scope를 가진 write 요청은 새 가구에 실행하지 않는다", () => {
    const subject = createSubject();
    const scopeA = subject.establish({
      principalUid: "uid-a",
      householdId: "house-a",
      memberId: "member-a",
    });
    subject.establish({
      principalUid: "uid-b",
      householdId: "house-b",
      memberId: "member-b",
    });

    expect(subject.requestWrite({ scope: scopeA, recordId: "a-record" })).toBe(
      "discarded",
    );
    expect(subject.state().writes).toEqual([]);
  });

  it("[T-SYS-008][SYS-008] Native mirror의 guest fallback보다 검증된 Membership 전체 scope를 원자 적용한다", () => {
    const subject = createSubject();
    const verified = subject.establish(
      {
        principalUid: "uid-verified",
        householdId: "house-verified",
        memberId: "member-verified",
      },
      {
        principalUid: "guest",
        householdId: "house-stale-native",
        memberId: "member-stale-native",
      },
    );

    expect(subject.state().scope).toEqual(verified);
    expect(subject.state().scope).toMatchObject({
      principalUid: "uid-verified",
      householdId: "house-verified",
      memberId: "member-verified",
    });
    expect(subject.state().cachedKeys).toEqual([]);
    expect(subject.state().activeSubscriptions).toEqual([]);
  });

  it("[T-SYS-008][SYS-008] logout은 같은 세대의 보호 상태와 구독을 원자적으로 폐기한다", () => {
    const subject = createSubject();
    subject.establish({
      principalUid: "uid-a",
      householdId: "house-a",
      memberId: "member-a",
    });
    subject.beginQuery("assets");
    subject.subscribe("assets-live");

    subject.logout();

    expect(subject.state()).toEqual({
      cachedKeys: [],
      activeSubscriptions: [],
      renderedRecordIds: [],
      writes: [],
      externalEffects: [],
    });
  });

  it("[T-SYS-008][SYS-008] 현재 세대의 query·subscription·write만 정상 반영한다", () => {
    const subject = createSubject();
    const scope = subject.establish({
      principalUid: "uid-a",
      householdId: "house-a",
      memberId: "member-a",
    });
    const query = subject.beginQuery("assets");
    const subscription = subject.subscribe("assets-live");

    expect(subject.receiveQuery({ token: query, recordIds: ["asset-1"] })).toBe(
      "committed",
    );
    expect(
      subject.receiveSubscription({
        ...subscription,
        recordIds: ["asset-2"],
      }),
    ).toBe("committed");
    expect(subject.requestWrite({ scope, recordId: "asset-3" })).toBe("accepted");
    expect(subject.state()).toMatchObject({
      renderedRecordIds: ["asset-2"],
      writes: [{ householdId: "house-a", recordId: "asset-3" }],
    });
  });
});
