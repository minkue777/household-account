import { describe, expect, it } from "vitest";
import type {
  MobileFidRegistrationInputPort,
  MobileSessionScope,
} from "../../../src/contexts/notifications/public";
import {
  createMobileFidRegistrationFixtureSubject,
  type MobileEndpointRegistrationSnapshot,
} from "../../support/mobile-fid-registration-driver";

/**
 * 지원 모바일 Client Controller와 RegisterEndpoint 공개 계약 사이의 seam입니다.
 * raw FID는 callback 입력에만 있고 snapshot·결과에는 노출하지 않습니다.
 */
export interface MobileFidRegistrationSubject
  extends MobileFidRegistrationInputPort {
  snapshot(): Promise<MobileEndpointRegistrationSnapshot>;
}

export function createSubject(): MobileFidRegistrationSubject {
  return createMobileFidRegistrationFixtureSubject();
}

const session: MobileSessionScope = {
  principalUid: "uid-member-1",
  householdId: "house-1",
  memberId: "member-1",
  sessionGeneration: 3,
};

describe("모바일 Firebase Installation ID 등록 Controller 공개 계약", () => {
  it("[T-PUSH-008][PUSH-001/PUSH-003] 지원 surface는 FID callback뿐이며 환경별 등록 capability와 Android 표시 권한을 분리한다", () => {
    const subject = createSubject();

    expect(subject.supportedRegistrationSurface()).toEqual([
      "register",
      "onRegistered",
      "onUnregistered",
      "logout",
    ]);
    expect(subject.supportedRegistrationSurface()).not.toEqual(
      expect.arrayContaining(["getToken", "onNewToken"]),
    );
    expect(
      subject.evaluateEnvironment({
        runtime: "android-app",
        osNotificationPermission: "denied",
      }),
    ).toEqual({
      kind: "eligible",
      platform: "android",
      registrationMechanism: "firebase-installation-id",
    });
    expect(
      subject.evaluateEnvironment({
        runtime: "ios-home-screen-pwa",
        osNotificationPermission: "granted",
      }),
    ).toEqual({
      kind: "eligible",
      platform: "ios-pwa",
      registrationMechanism: "firebase-installation-id",
    });
    expect(
      subject.evaluateEnvironment({
        runtime: "ios-home-screen-pwa",
        osNotificationPermission: "denied",
      }),
    ).toEqual({
      kind: "not-eligible",
      reason: "IOS_NOTIFICATION_PERMISSION_REQUIRED",
    });
    expect(
      subject.evaluateEnvironment({
        runtime: "ios-browser",
        osNotificationPermission: "granted",
      }),
    ).toEqual({
      kind: "not-eligible",
      reason: "IOS_HOME_SCREEN_INSTALL_REQUIRED",
    });
    expect(
      subject.evaluateEnvironment({
        runtime: "desktop-web",
        osNotificationPermission: "granted",
      }),
    ).toEqual({
      kind: "not-eligible",
      reason: "DESKTOP_NOT_SUPPORTED",
    });
  });

  it("[T-PUSH-008][PUSH-002/PUSH-003] 로그인 Membership 확정 전의 FID callback은 endpoint를 만들지 않는다", async () => {
    const subject = createSubject();

    const result = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "granted",
      fid: "FID-BEFORE-SESSION",
      deviceInfo: { model: "Pixel" },
    });

    expect(result).toEqual({ kind: "ignored", reason: "SESSION_REQUIRED" });
    expect(await subject.snapshot()).toEqual({ endpoints: [] });
  });

  it("[T-PUSH-008][PUSH-001/PUSH-002/PUSH-003] 로그인한 iPhone 홈 화면 PWA의 onRegistered는 설치 endpoint와 최소 metadata를 저장하고 FID를 결과에 노출하지 않는다", async () => {
    const subject = createSubject();
    subject.restoreSession(session);

    const result = await subject.onRegistered({
      runtime: "ios-home-screen-pwa",
      osNotificationPermission: "granted",
      fid: "FID-IOS-A",
      deviceInfo: {
        model: "iPhone",
        osVersion: "iOS 20",
        sdkVersion: "firebase-web-13",
        appVersion: "2.0.0",
      },
    });

    expect(result).toEqual({
      kind: "registered",
      endpointId: expect.any(String),
      registrationVersion: 1,
      result: "created",
    });
    expect(result).not.toHaveProperty("fid");
    if (result.kind !== "registered") {
      throw new Error("iPhone FID 등록이 성공하지 않았습니다.");
    }
    expect(await subject.snapshot()).toEqual({
      session,
      endpoints: [
        {
          endpointId: result.endpointId,
          householdId: "house-1",
          memberId: "member-1",
          platform: "ios-pwa",
          status: "active",
          registrationVersion: 1,
          bindingVersion: 1,
          deviceInfo: {
            model: "iPhone",
            osVersion: "iOS 20",
            sdkVersion: "firebase-web-13",
            appVersion: "2.0.0",
          },
        },
      ],
    });
    expect((await subject.snapshot()).endpoints[0]).not.toHaveProperty("fid");
  });

  it("[T-PUSH-008][PUSH-002/PUSH-003] 재설치로 받은 새 FID는 기존 설치를 덮지 않고 같은 멤버의 별도 endpoint가 된다", async () => {
    const subject = createSubject();
    subject.restoreSession(session);

    const first = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "denied",
      fid: "FID-ANDROID-A",
      deviceInfo: { model: "Galaxy A", appVersion: "2.0.0" },
    });
    const reinstalled = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "denied",
      fid: "FID-ANDROID-B",
      deviceInfo: { model: "Galaxy A", appVersion: "2.0.0" },
    });

    expect(first).toMatchObject({ kind: "registered", result: "created" });
    expect(reinstalled).toMatchObject({ kind: "registered", result: "created" });
    const endpoints = (await subject.snapshot()).endpoints;
    expect(endpoints).toHaveLength(2);
    expect(new Set(endpoints.map(({ endpointId }) => endpointId)).size).toBe(2);
    expect(endpoints.every(({ memberId }) => memberId === "member-1")).toBe(true);
    expect(endpoints.every(({ status }) => status === "active")).toBe(true);
  });

  it("[T-PUSH-008][PUSH-003] onUnregistered는 현재 registration version만 inactive로 만들고 로그아웃은 현재 설치 endpoint만 삭제한다", async () => {
    const subject = createSubject();
    subject.restoreSession(session);
    const endpointA = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "granted",
      fid: "FID-A",
      deviceInfo: { model: "Galaxy A" },
    });
    const endpointB = await subject.onRegistered({
      runtime: "ios-home-screen-pwa",
      osNotificationPermission: "granted",
      fid: "FID-B",
      deviceInfo: { model: "iPhone B" },
    });
    if (endpointA.kind !== "registered" || endpointB.kind !== "registered") {
      throw new Error("테스트 준비용 endpoint 등록이 실패했습니다.");
    }

    await expect(
      subject.onUnregistered({
        fid: "FID-A",
        expectedRegistrationVersion: 0,
      }),
    ).resolves.toEqual({
      kind: "stale-ignored",
      endpointId: endpointA.endpointId,
    });
    await expect(
      subject.onUnregistered({
        fid: "FID-A",
        expectedRegistrationVersion: 1,
      }),
    ).resolves.toEqual({
      kind: "inactivated",
      endpointId: endpointA.endpointId,
    });
    await expect(subject.logoutCurrentInstallation("FID-B")).resolves.toEqual({
      kind: "removed",
      endpointId: endpointB.endpointId,
    });

    expect((await subject.snapshot()).endpoints).toEqual([
      expect.objectContaining({
        endpointId: endpointA.endpointId,
        status: "inactive",
      }),
    ]);
  });

  it("[T-PUSH-008][PUSH-002/PUSH-003] 같은 FID 재등록은 같은 endpoint를 active로 갱신하고 registration version만 증가시킨다", async () => {
    const subject = createSubject();
    subject.restoreSession(session);
    const created = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "denied",
      fid: "FID-REFRESH",
      deviceInfo: { model: "Galaxy", appVersion: "2.0.0" },
    });
    if (created.kind !== "registered") {
      throw new Error("테스트 준비용 endpoint 등록이 실패했습니다.");
    }
    await subject.onUnregistered({
      fid: "FID-REFRESH",
      expectedRegistrationVersion: created.registrationVersion,
    });

    const refreshed = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "denied",
      fid: "FID-REFRESH",
      deviceInfo: { model: "Galaxy", appVersion: "2.1.0" },
    });

    expect(refreshed).toEqual({
      kind: "registered",
      endpointId: created.endpointId,
      registrationVersion: 2,
      result: "refreshed",
    });
    expect((await subject.snapshot()).endpoints).toEqual([
      expect.objectContaining({
        endpointId: created.endpointId,
        status: "active",
        registrationVersion: 2,
        bindingVersion: 1,
        deviceInfo: { model: "Galaxy", appVersion: "2.1.0" },
      }),
    ]);
  });

  it("[T-PUSH-008][PUSH-002/PUSH-003] 로그아웃 삭제가 유실된 같은 FID는 새 로그인 binding 하나로 원자 재연결한다", async () => {
    const subject = createSubject();
    subject.restoreSession(session);
    const previous = await subject.onRegistered({
      runtime: "ios-home-screen-pwa",
      osNotificationPermission: "granted",
      fid: "FID-STALE-BINDING",
      deviceInfo: { model: "iPhone A" },
    });
    if (previous.kind !== "registered") {
      throw new Error("테스트 준비용 endpoint 등록이 실패했습니다.");
    }

    const nextSession: MobileSessionScope = {
      principalUid: "uid-member-2",
      householdId: "house-2",
      memberId: "member-2",
      sessionGeneration: 4,
    };
    subject.restoreSession(nextSession);
    const recovered = await subject.onRegistered({
      runtime: "android-app",
      osNotificationPermission: "denied",
      fid: "FID-STALE-BINDING",
      deviceInfo: { model: "Galaxy B" },
    });

    expect(recovered).toEqual({
      kind: "registered",
      endpointId: previous.endpointId,
      registrationVersion: 2,
      result: "stale-binding-recovered",
    });
    expect(await subject.snapshot()).toEqual({
      session: nextSession,
      endpoints: [
        expect.objectContaining({
          endpointId: previous.endpointId,
          householdId: "house-2",
          memberId: "member-2",
          platform: "android",
          status: "active",
          registrationVersion: 2,
          bindingVersion: 2,
        }),
      ],
    });
  });

  it("[T-PUSH-008][PUSH-002] 빈 FID callback은 endpoint를 만들지 않는다", async () => {
    const subject = createSubject();
    subject.restoreSession(session);

    await expect(
      subject.onRegistered({
        runtime: "android-app",
        osNotificationPermission: "granted",
        fid: "   ",
        deviceInfo: {},
      }),
    ).resolves.toEqual({
      kind: "validation-error",
      code: "FID_REQUIRED",
    });
    expect((await subject.snapshot()).endpoints).toEqual([]);
  });
});
