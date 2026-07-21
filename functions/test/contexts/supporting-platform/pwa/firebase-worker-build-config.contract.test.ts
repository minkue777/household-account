import { describe, expect, it } from "vitest";
import {
  createFirebaseWorkerBuildConfigDriver,
  type FirebasePublicBuildConfig as BuildConfig,
  type FirebaseWorkerBuildConfigDriver,
  type FirebaseWorkerBuildConfigFixture,
  type FirebaseWorkerBuildResult as BuildResult,
  type FirebaseWorkerBuildState as BuildState,
} from "../../../support/firebase-worker-build-config-driver";

export type FirebasePublicBuildConfig = BuildConfig;
export type FirebaseWorkerBuildResult = BuildResult;
export type FirebaseWorkerBuildState = BuildState;

export interface FirebaseWorkerBuildConfigContractSubject
  extends FirebaseWorkerBuildConfigDriver {}

export function createSubject(fixture: {
  supportedSdkPairs: readonly {
    appSdkVersion: string;
    workerMessagingSdkVersion: string;
  }[];
  emittedFiles?: readonly { path: string; contents: string }[];
}): FirebaseWorkerBuildConfigContractSubject {
  return createFirebaseWorkerBuildConfigDriver(fixture);
}

const config: FirebasePublicBuildConfig = {
  projectId: "household-production",
  appId: "app-1",
  messagingSenderId: "sender-1",
  apiKey: "public-api-key",
};

const createBuildSubject = (
  fixture: Omit<FirebaseWorkerBuildConfigFixture, "supportedSdkPairs"> = {},
): FirebaseWorkerBuildConfigContractSubject =>
  createSubject({
    supportedSdkPairs: [
      { appSdkVersion: "12.1.0", workerMessagingSdkVersion: "12.1.0" },
    ],
    ...fixture,
  });

describe("Firebase Web·통합 worker production build 공개 계약", () => {
  it("[T-PWA-003][PWA-005] Web과 worker는 같은 build 원본의 동일 Firebase project 설정을 사용한다", () => {
    const subject = createBuildSubject();

    const result = subject.build({
      configSourceId: "firebase-public-config-v1",
      publicConfig: config,
      appSdkVersion: "12.1.0",
      workerMessagingSdkVersion: "12.1.0",
    });

    expect(result).toMatchObject({
      kind: "Built",
      artifact: {
        webConfig: config,
        workerConfig: config,
        configSourceId: "firebase-public-config-v1",
        appSdkVersion: "12.1.0",
        workerMessagingSdkVersion: "12.1.0",
        emittedFiles: expect.any(Array),
      },
    });
    expect(subject.state()).toEqual({
      artifacts: [
        {
          configSourceId: "firebase-public-config-v1",
          projectId: "household-production",
        },
      ],
    });
  });

  it("[T-PWA-003][PWA-005] 실제 worker artifact는 통합 sw.js 하나이며 compat SDK·deprecated API·Firebase 값 hardcode를 포함하지 않는다", () => {
    const result = createBuildSubject().build({
      configSourceId: "firebase-public-config-v1",
      publicConfig: config,
      appSdkVersion: "12.1.0",
      workerMessagingSdkVersion: "12.1.0",
    });
    if (result.kind !== "Built") {
      throw new Error("지원되는 production build가 성공해야 합니다.");
    }

    expect(result.artifact.emittedFiles.map(({ path }) => path)).toEqual([
      "/sw.js",
    ]);
    const workerArtifact = result.artifact.emittedFiles.find(
      ({ path }) => path === "/sw.js",
    );
    expect(workerArtifact?.contents.length).toBeGreaterThan(0);
    expect(workerArtifact?.contents).not.toMatch(
      /firebase-(?:app|messaging)-compat|getToken\s*\(/,
    );
    for (const hardcodedValue of Object.values(config)) {
      expect(workerArtifact?.contents).not.toContain(hardcodedValue);
    }
  });

  it("[T-PWA-003][PWA-005] 값이 같은 worker 설정 복사본은 단일 build 원본의 동일 설정으로 취급한다", () => {
    const result = createBuildSubject().build({
      configSourceId: "firebase-public-config-v1",
      publicConfig: config,
      workerConfigOverride: { ...config },
      appSdkVersion: "12.1.0",
      workerMessagingSdkVersion: "12.1.0",
    });

    expect(result).toMatchObject({
      kind: "Built",
      artifact: { webConfig: config, workerConfig: config },
    });
  });

  it.each([
    ["projectId", "wrong-project"],
    ["appId", "wrong-app"],
    ["messagingSenderId", "wrong-sender"],
    ["apiKey", "wrong-api-key"],
  ] as const)(
    "[T-PWA-003][PWA-005] worker 설정의 %s가 단일 원본과 다르면 artifact를 만들지 않는다",
    (field, mismatchedValue) => {
      const subject = createBuildSubject();

      expect(
        subject.build({
          configSourceId: "firebase-public-config-v1",
          publicConfig: config,
          workerConfigOverride: { ...config, [field]: mismatchedValue },
          appSdkVersion: "12.1.0",
          workerMessagingSdkVersion: "12.1.0",
        }),
      ).toEqual({ kind: "BuildFailed", code: "FIREBASE_CONFIG_DRIFT" });
      expect(subject.state().artifacts).toEqual([]);
    },
  );

  it("[T-PWA-003][PWA-005] 지원 matrix 밖의 SDK 조합은 production build를 실패시킨다", () => {
    const subject = createBuildSubject();

    expect(
      subject.build({
        configSourceId: "firebase-public-config-v1",
        publicConfig: config,
        appSdkVersion: "12.1.0",
        workerMessagingSdkVersion: "9.0.0-compat",
      }),
    ).toEqual({ kind: "BuildFailed", code: "FIREBASE_SDK_INCOMPATIBLE" });
    expect(subject.state().artifacts).toEqual([]);
  });

  it("[T-PWA-003][PWA-005] 각각 지원되는 version이라도 matrix에 없는 교차 조합은 허용하지 않는다", () => {
    const subject = createSubject({
      supportedSdkPairs: [
        { appSdkVersion: "12.1.0", workerMessagingSdkVersion: "12.1.0" },
        { appSdkVersion: "12.2.0", workerMessagingSdkVersion: "12.2.1" },
      ],
    });

    expect(
      subject.build({
        configSourceId: "firebase-public-config-v1",
        publicConfig: config,
        appSdkVersion: "12.1.0",
        workerMessagingSdkVersion: "12.2.1",
      }),
    ).toEqual({ kind: "BuildFailed", code: "FIREBASE_SDK_INCOMPATIBLE" });
  });

  it("[T-PWA-003][PWA-005] app과 worker version 문자열이 같아도 matrix에 없으면 허용하지 않는다", () => {
    expect(
      createBuildSubject().build({
        configSourceId: "firebase-public-config-v1",
        publicConfig: config,
        appSdkVersion: "12.2.0",
        workerMessagingSdkVersion: "12.2.0",
      }),
    ).toEqual({ kind: "BuildFailed", code: "FIREBASE_SDK_INCOMPATIBLE" });
  });

  it.each([
    { name: "worker 파일 없음", emittedFiles: [] },
    {
      name: "구 Firebase worker만 존재",
      emittedFiles: [
        { path: "/firebase-messaging-sw.js", contents: "legacy worker" },
      ],
    },
    {
      name: "통합 worker 외 파일을 함께 산출",
      emittedFiles: [
        { path: "/sw.js", contents: "integrated worker" },
        { path: "/worker-copy.js", contents: "duplicate worker" },
      ],
    },
    {
      name: "통합 worker 내용이 비어 있음",
      emittedFiles: [{ path: "/sw.js", contents: "   " }],
    },
    {
      name: "messaging compat SDK import",
      emittedFiles: [
        {
          path: "/sw.js",
          contents: 'importScripts("firebase-messaging-compat.js")',
        },
      ],
    },
    {
      name: "app compat SDK import",
      emittedFiles: [
        {
          path: "/sw.js",
          contents: 'importScripts("firebase-app-compat.js")',
        },
      ],
    },
    {
      name: "compat namespace API",
      emittedFiles: [
        { path: "/sw.js", contents: "firebase.initializeApp(config)" },
      ],
    },
    {
      name: "deprecated getToken API",
      emittedFiles: [
        { path: "/sw.js", contents: "const token = getToken(messaging)" },
      ],
    },
    {
      name: "구 worker 경로 참조",
      emittedFiles: [
        {
          path: "/sw.js",
          contents: 'register("/firebase-messaging-sw.js")',
        },
      ],
    },
    {
      name: "Firebase projectId hardcode",
      emittedFiles: [
        {
          path: "/sw.js",
          contents: 'const projectId = "household-production"',
        },
      ],
    },
    {
      name: "Firebase appId hardcode",
      emittedFiles: [
        { path: "/sw.js", contents: 'const appId = "app-1"' },
      ],
    },
    {
      name: "Firebase messagingSenderId hardcode",
      emittedFiles: [
        { path: "/sw.js", contents: 'const sender = "sender-1"' },
      ],
    },
    {
      name: "Firebase apiKey hardcode",
      emittedFiles: [
        { path: "/sw.js", contents: 'const apiKey = "public-api-key"' },
      ],
    },
  ])(
    "[T-PWA-003][PWA-005] $name 상태의 production worker artifact는 build를 실패시킨다",
    ({ emittedFiles }) => {
      const subject = createBuildSubject({ emittedFiles });

      expect(
        subject.build({
          configSourceId: "firebase-public-config-v1",
          publicConfig: config,
          appSdkVersion: "12.1.0",
          workerMessagingSdkVersion: "12.1.0",
        }),
      ).toEqual({ kind: "BuildFailed", code: "WORKER_ARTIFACT_UNSAFE" });
      expect(subject.state().artifacts).toEqual([]);
    },
  );

  it("[T-PWA-003][PWA-005] 실패한 재build는 이미 검증된 성공 artifact 이력을 오염시키지 않는다", () => {
    const subject = createBuildSubject();
    subject.build({
      configSourceId: "firebase-public-config-v1",
      publicConfig: config,
      appSdkVersion: "12.1.0",
      workerMessagingSdkVersion: "12.1.0",
    });

    expect(
      subject.build({
        configSourceId: "firebase-public-config-v2",
        publicConfig: config,
        workerConfigOverride: { ...config, projectId: "wrong-project" },
        appSdkVersion: "12.1.0",
        workerMessagingSdkVersion: "12.1.0",
      }),
    ).toEqual({ kind: "BuildFailed", code: "FIREBASE_CONFIG_DRIFT" });
    expect(subject.state()).toEqual({
      artifacts: [
        {
          configSourceId: "firebase-public-config-v1",
          projectId: "household-production",
        },
      ],
    });
  });

  it("[T-PWA-003][PWA-005] build 뒤 입력 객체가 바뀌어도 검증된 Web·worker 설정 snapshot은 바뀌지 않는다", () => {
    const mutableConfig = { ...config };
    const subject = createBuildSubject();
    const result = subject.build({
      configSourceId: "firebase-public-config-v1",
      publicConfig: mutableConfig,
      appSdkVersion: "12.1.0",
      workerMessagingSdkVersion: "12.1.0",
    });
    mutableConfig.projectId = "mutated-after-build";

    expect(result).toMatchObject({
      kind: "Built",
      artifact: {
        webConfig: { projectId: "household-production" },
        workerConfig: { projectId: "household-production" },
      },
    });
    expect(subject.state().artifacts[0]?.projectId).toBe(
      "household-production",
    );
  });
});
