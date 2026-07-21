import { describe, expect, it } from "vitest";

import { createWebShellFixture } from "../../../support/web-shell-fixture";

export interface AndroidWebEnvironment {
  environment: "production" | "development";
  configVersion: string;
  startUrl: string;
  allowedOrigin: string;
}

export type WebShellInitializationResult =
  | { kind: "Loaded"; url: string; loadCount: 1 }
  | { kind: "RestoredWithoutReload"; url: string; loadCount: 0 }
  | {
      kind: "BuildRejected";
      code: "INSECURE_START_URL" | "ORIGIN_MISMATCH" | "UNKNOWN_ENVIRONMENT";
    };

export type AndroidBackResult =
  | { kind: "WebHistoryNavigated" }
  | { kind: "ActivityDelegated" };

export type AndroidVersionPresentation =
  | { kind: "Known"; value: string }
  | { kind: "Unknown"; value: string };

export interface AndroidWebShellContractSubject {
  initialize(input: {
    environment: AndroidWebEnvironment;
    restoredNavigationUrl?: string;
  }): WebShellInitializationResult;
  onBack(input: {
    screen: "permission-guide" | "web-shell";
    webViewCanGoBack: boolean;
  }): AndroidBackResult;
  presentVersion(input: {
    versionName?: string;
    packageLookupSucceeded: boolean;
  }): AndroidVersionPresentation;
}

export function createSubject(): AndroidWebShellContractSubject {
  return createWebShellFixture();
}

const production: AndroidWebEnvironment = {
  environment: "production",
  configVersion: "android-web-environment.v1",
  startUrl: "https://household.example/app",
  allowedOrigin: "https://household.example",
};

describe("Android Web Shell 환경·탐색·버전 공개 계약", () => {
  it("[T-WEBVIEW-002][AND-003] fresh 시작은 versioned 설정의 HTTPS URL을 정확히 한 번 load한다", () => {
    expect(createSubject().initialize({ environment: production })).toEqual({
      kind: "Loaded",
      url: "https://household.example/app",
      loadCount: 1,
    });
  });

  it("[T-WEBVIEW-002][AND-003] 저장된 navigation이 있으면 start URL을 중복 load하지 않는다", () => {
    expect(
      createSubject().initialize({
        environment: production,
        restoredNavigationUrl: "https://household.example/assets",
      }),
    ).toEqual({
      kind: "RestoredWithoutReload",
      url: "https://household.example/assets",
      loadCount: 0,
    });
  });

  it.each([
    {
      environment: { ...production, startUrl: "http://household.example/app" },
      code: "INSECURE_START_URL" as const,
    },
    {
      environment: {
        ...production,
        allowedOrigin: "https://other.example",
      },
      code: "ORIGIN_MISMATCH" as const,
    },
    {
      environment: { ...production, environment: "staging" as const },
      code: "UNKNOWN_ENVIRONMENT" as const,
    },
  ])(
    "[T-WEBVIEW-002][AND-003] URL·origin·환경 설정 불일치는 $code로 빌드를 거부한다",
    ({ environment, code }) => {
      expect(
        createSubject().initialize({
          environment: environment as AndroidWebEnvironment,
        }),
      ).toEqual({ kind: "BuildRejected", code });
    },
  );

  it.each([
    {
      restoredNavigationUrl: "http://household.example/assets",
      code: "INSECURE_START_URL" as const,
    },
    {
      restoredNavigationUrl: "https://attacker.example/assets",
      code: "ORIGIN_MISMATCH" as const,
    },
  ])(
    "저장된 navigation도 HTTPS와 같은 origin 검증을 다시 거친다: $code",
    ({ restoredNavigationUrl, code }) => {
      expect(
        createSubject().initialize({
          environment: production,
          restoredNavigationUrl,
        }),
      ).toEqual({ kind: "BuildRejected", code });
    },
  );

  it.each([
    {
      screen: "web-shell" as const,
      canGoBack: true,
      expected: { kind: "WebHistoryNavigated" as const },
    },
    {
      screen: "web-shell" as const,
      canGoBack: false,
      expected: { kind: "ActivityDelegated" as const },
    },
    {
      screen: "permission-guide" as const,
      canGoBack: true,
      expected: { kind: "ActivityDelegated" as const },
    },
  ])(
    "[T-WEBVIEW-003][AND-004] $screen에서 Web history 가능=$canGoBack인 뒤로가기를 계약대로 위임한다",
    ({ screen, canGoBack, expected }) => {
      expect(
        createSubject().onBack({
          screen,
          webViewCanGoBack: canGoBack,
        }),
      ).toEqual(expected);
    },
  );

  it("[T-ANDROID-VERSION-001][AND-007] package versionName을 계약 prefix와 함께 표시한다", () => {
    expect(
      createSubject().presentVersion({
        versionName: "2.7.1",
        packageLookupSucceeded: true,
      }),
    ).toEqual({ kind: "Known", value: "앱 버전 2.7.1" });
  });

  it.each([
    { versionName: undefined, packageLookupSucceeded: true },
    { versionName: "2.7.1", packageLookupSucceeded: false },
  ])(
    "[T-ANDROID-VERSION-001][AND-007] version 조회 실패나 값 부재는 알 수 없음으로 표시한다",
    (input) => {
      expect(createSubject().presentVersion(input)).toEqual({
        kind: "Unknown",
        value: "앱 버전 알 수 없음",
      });
    },
  );

  it("빈 package versionName은 조회 성공으로 가장하지 않는다", () => {
    expect(
      createSubject().presentVersion({
        versionName: "",
        packageLookupSucceeded: true,
      }),
    ).toEqual({ kind: "Unknown", value: "앱 버전 알 수 없음" });
  });
});
