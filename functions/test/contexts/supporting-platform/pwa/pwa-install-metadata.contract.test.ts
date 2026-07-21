import { describe, expect, it } from "vitest";
import {
  createPwaInstallMetadataDriver,
  type PwaBootstrapResult as BootstrapResult,
  type PwaInstallMetadataDriver,
  type PwaInstallMetadataFixture,
  type PwaManifestMetadata,
} from "../../../support/pwa-install-metadata-driver";

export type PwaManifestFixture = PwaManifestMetadata;
export type PwaBootstrapResult = BootstrapResult;

export interface PwaInstallMetadataContractSubject
  extends PwaInstallMetadataDriver {}

export function createSubject(
  fixture?: PwaInstallMetadataFixture,
): PwaInstallMetadataContractSubject {
  return createPwaInstallMetadataDriver(fixture);
}

const validManifest: PwaManifestFixture = {
  name: "가계부",
  shortName: "가계부",
  display: "standalone",
  orientation: "portrait",
  startUrl: "/",
  scope: "/",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192" },
    { src: "/icons/icon-512.png", sizes: "512x512" },
  ],
};

describe("PWA 설치 metadata와 환경별 초기화 공개 계약", () => {
  it("[T-PWA-INSTALL-001][PWA-001] production은 standalone·portrait 설치 metadata와 root worker 하나를 활성화한다", async () => {
    expect(
      await createSubject().bootstrap({
        environment: "production",
        manifest: validManifest,
      }),
    ).toEqual({
      kind: "Enabled",
      workerRegistrations: [{ scope: "/", scriptUrl: "/sw.js" }],
      installability: "installable",
      display: "standalone",
      orientation: "portrait",
    });
  });

  it("[T-PWA-INSTALL-001][PWA-001] development에서는 manifest가 유효해도 PWA worker를 등록하지 않는다", async () => {
    expect(
      await createSubject().bootstrap({
        environment: "development",
        manifest: validManifest,
      }),
    ).toEqual({
      kind: "DisabledForDevelopment",
      workerRegistrations: [],
    });
  });

  it.each([
    {
      manifest: { ...validManifest, display: "browser" },
      code: "DISPLAY_NOT_STANDALONE" as const,
    },
    {
      manifest: { ...validManifest, orientation: "landscape" },
      code: "ORIENTATION_NOT_PORTRAIT" as const,
    },
    {
      manifest: { ...validManifest, startUrl: "/app", scope: "/other" },
      code: "INVALID_SCOPE" as const,
    },
    {
      manifest: { ...validManifest, icons: [] },
      code: "INSTALL_ICON_MISSING" as const,
    },
  ])(
    "[T-PWA-INSTALL-001][PWA-001] 설치 metadata 결함은 $code로 명시하고 worker를 등록하지 않는다",
    async ({ manifest, code }) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest,
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code,
        workerRegistrations: [],
      });
    },
  );

  it.each([
    { name: undefined, shortName: undefined },
    { name: "   ", shortName: "\t" },
  ])(
    "[T-PWA-INSTALL-001][PWA-001] 설치 이름이 없거나 공백뿐이면 configuration을 거부한다",
    async ({ name, shortName }) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest: { ...validManifest, name, shortName },
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code: "INSTALL_NAME_MISSING",
        workerRegistrations: [],
      });
    },
  );

  it.each([
    { name: "가계부", shortName: undefined },
    { name: undefined, shortName: "가계부" },
  ])(
    "[T-PWA-INSTALL-001][PWA-001] name 또는 shortName 중 하나의 설치 이름만 있어도 설치 가능하다",
    async ({ name, shortName }) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest: { ...validManifest, name, shortName },
        }),
      ).toMatchObject({ kind: "Enabled", installability: "installable" });
    },
  );

  it.each([undefined, "fullscreen", "minimal-ui"])(
    "[T-PWA-INSTALL-001][PWA-001] display=%s는 standalone 설치 계약으로 인정하지 않는다",
    async (display) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest: { ...validManifest, display },
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code: "DISPLAY_NOT_STANDALONE",
        workerRegistrations: [],
      });
    },
  );

  it.each([undefined, "portrait-primary", "landscape-primary"])(
    "[T-PWA-INSTALL-001][PWA-001] orientation=%s는 portrait 전용 설치 계약으로 인정하지 않는다",
    async (orientation) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest: { ...validManifest, orientation },
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code: "ORIENTATION_NOT_PORTRAIT",
        workerRegistrations: [],
      });
    },
  );

  it.each([
    { startUrl: undefined, scope: "/" },
    { startUrl: "/", scope: undefined },
    { startUrl: "/app", scope: "/" },
    { startUrl: "/", scope: "/app" },
    { startUrl: "https://external.example/", scope: "/" },
  ])(
    "[T-PWA-INSTALL-001][PWA-001/PWA-003] startUrl=$startUrl, scope=$scope 구성은 root 설치·worker 경계와 일치하지 않는다",
    async ({ startUrl, scope }) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest: { ...validManifest, startUrl, scope },
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code: "INVALID_SCOPE",
        workerRegistrations: [],
      });
    },
  );

  it.each([
    {
      name: "192 아이콘만 존재",
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
    },
    {
      name: "512 아이콘만 존재",
      icons: [{ src: "/icons/icon-512.png", sizes: "512x512" }],
    },
    {
      name: "필수 크기가 아닌 아이콘",
      icons: [{ src: "/icons/icon-256.png", sizes: "256x256" }],
    },
    {
      name: "아이콘 src가 공백",
      icons: [
        { src: " ", sizes: "192x192" },
        { src: "/icons/icon-512.png", sizes: "512x512" },
      ],
    },
    {
      name: "외부 origin 아이콘",
      icons: [
        { src: "https://external.example/icon.png", sizes: "192x192" },
        { src: "/icons/icon-512.png", sizes: "512x512" },
      ],
    },
  ])(
    "[T-PWA-INSTALL-001][PWA-001] $name 상태는 필수 설치 icon metadata를 충족하지 않는다",
    async ({ icons }) => {
      expect(
        await createSubject().bootstrap({
          environment: "production",
          manifest: { ...validManifest, icons },
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code: "INSTALL_ICON_MISSING",
        workerRegistrations: [],
      });
    },
  );

  it("[T-PWA-INSTALL-001][PWA-001] development는 결함 있는 manifest도 PWA 초기화 대상으로 삼지 않는다", async () => {
    expect(
      await createSubject().bootstrap({
        environment: "development",
        manifest: {
          display: "browser",
          orientation: "landscape",
          startUrl: "/app",
          scope: "/other",
          icons: [],
        },
      }),
    ).toEqual({
      kind: "DisabledForDevelopment",
      workerRegistrations: [],
    });
  });

  it.each([
    {
      name: "worker 등록 실패",
      rootRuntime: { workerRegistrationResult: "failure" as const },
    },
    {
      name: "검증되지 않은 worker artifact",
      rootRuntime: {
        workerArtifactPaths: ["/sw.js", "/firebase-messaging-sw.js"],
      },
    },
  ])(
    "[T-PWA-INSTALL-001/T-PWA-001][PWA-001/PWA-003] $name 상태를 installable로 숨기지 않는다",
    async ({ rootRuntime }) => {
      expect(
        await createSubject({ rootRuntime }).bootstrap({
          environment: "production",
          manifest: validManifest,
        }),
      ).toEqual({
        kind: "ConfigurationRejected",
        code: "ROOT_WORKER_UNAVAILABLE",
        workerRegistrations: [],
      });
    },
  );

  it("[T-PWA-INSTALL-001/T-PWA-001][PWA-001/PWA-003/PWA-008] waiting update가 있어도 현재 active root worker로 설치 가능 상태를 유지한다", async () => {
    expect(
      await createSubject({
        rootRuntime: {
          activeWorkerVersion: "worker-v1",
          waitingWorkerVersion: "worker-v2",
        },
      }).bootstrap({
        environment: "production",
        manifest: validManifest,
      }),
    ).toEqual({
      kind: "Enabled",
      workerRegistrations: [{ scope: "/", scriptUrl: "/sw.js" }],
      installability: "installable",
      display: "standalone",
      orientation: "portrait",
    });
  });

  it("[T-PWA-INSTALL-001/T-PWA-001][PWA-001/PWA-003] bootstrap을 반복해도 root worker registration은 하나다", async () => {
    const subject = createSubject();

    await subject.bootstrap({
      environment: "production",
      manifest: validManifest,
    });
    expect(
      await subject.bootstrap({
        environment: "production",
        manifest: validManifest,
      }),
    ).toMatchObject({
      kind: "Enabled",
      workerRegistrations: [{ scope: "/", scriptUrl: "/sw.js" }],
    });
  });
});
