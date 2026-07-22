import { describe, expect, it } from "vitest";

import {
  FidLogoutDeliveryGateFixture,
  type CleanupOutcome,
  type FidBindingFixture,
  type LogoutFixtureInput,
  type LogoutFixtureResult,
  type RegistrationFixtureResult,
} from "../../../support/fid-logout-delivery-gate-fixture";

export interface FidLogoutDeliveryGateContractSubject {
  logout(input: LogoutFixtureInput): LogoutFixtureResult;
  startWithoutSession(): void;
  login(
    householdId: string,
    memberId: string,
    staleUnregistration: CleanupOutcome,
  ): RegistrationFixtureResult;
  confirm(binding: FidBindingFixture): void;
  canDisplay(): boolean;
}

export function createSubject(
  binding: FidBindingFixture | null = {
    householdId: "household-a",
    memberId: "member-a",
    registrationVersion: 3,
  },
): FidLogoutDeliveryGateContractSubject {
  return new FidLogoutDeliveryGateFixture(binding);
}

describe("Android FID 로그아웃 local delivery gate 계약", () => {
  it("[T-ANDROID-FCM-LOGOUT-001][T-PUSH-010][AND-013/PUSH-003/PUSH-008] component 차단을 먼저 수행하고 정리 실패와 무관하게 로그아웃한다", () => {
    const subject = createSubject();

    const result = subject.logout({
      componentDisableSucceeds: true,
      suppression: "failed",
      remoteRemoval: "failed",
      localUnregistration: "timed-out",
    });

    expect(result).toMatchObject({
      loggedOut: true,
      componentBlocked: true,
      notificationsCancelled: true,
      suppression: "failed",
      remoteRemoval: "failed",
      localUnregistration: "timed-out",
    });
    expect(result.events.slice(0, 3)).toEqual([
      "component-disable-attempt",
      "notification-cancel-attempt",
      "suppression-persist-attempt",
    ]);
    expect(result.events).toContain("remote-remove-start");
    expect(result.events).toContain("local-unregister-start");
  });

  it("[T-ANDROID-FCM-LOGOUT-001][AND-005/AND-013] component 차단 자체가 실패해도 원격·로컬 정리를 모두 시도하고 로그아웃을 막지 않는다", () => {
    const subject = createSubject();

    const result = subject.logout({
      componentDisableSucceeds: false,
      suppression: "succeeded",
      remoteRemoval: "succeeded",
      localUnregistration: "succeeded",
    });

    expect(result.loggedOut).toBe(true);
    expect(result.componentBlocked).toBe(false);
    expect(result.events).toContain("remote-remove-start");
    expect(result.events).toContain("local-unregister-start");
  });

  it("[T-PUSH-010][AND-013/PUSH-003/PUSH-007] 세션 없는 시작을 차단하고 stale 정리 뒤 현재 binding 확인에서만 표시한다", () => {
    const subject = createSubject();
    subject.logout({
      componentDisableSucceeds: true,
      suppression: "succeeded",
      remoteRemoval: "failed",
      localUnregistration: "failed",
    });
    subject.startWithoutSession();

    const registration = subject.login(
      "household-b",
      "member-b",
      "succeeded",
    );

    expect(registration).toEqual({
      started: true,
      events: [
        "stale-unregister-start",
        "component-enable",
        "registration-start",
      ],
    });
    expect(subject.canDisplay()).toBe(false);

    subject.confirm({
      householdId: "household-b",
      memberId: "member-b",
      registrationVersion: 1,
    });
    expect(subject.canDisplay()).toBe(true);
  });

  it("[T-PUSH-010][AND-013/PUSH-007] stale unregister가 실패하면 component를 열지 않고 표시하지 않는다", () => {
    const subject = createSubject();
    subject.logout({
      componentDisableSucceeds: true,
      suppression: "succeeded",
      remoteRemoval: "failed",
      localUnregistration: "failed",
    });

    expect(subject.login("household-b", "member-b", "failed")).toEqual({
      started: false,
      events: ["stale-unregister-start"],
    });
    expect(subject.canDisplay()).toBe(false);
  });
});
