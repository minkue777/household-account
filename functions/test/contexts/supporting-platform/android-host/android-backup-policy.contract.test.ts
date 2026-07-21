import { describe, expect, it } from "vitest";
import {
  createBackupPolicyFixtureSubject,
  type BackupPolicyFixtureSubject,
  type BackupPolicyLocalDataFixture,
  type BackupPolicyLocalDataKey,
} from "../../../support/backup-policy-fixture";

export interface AndroidBackupPolicyContractSubject
  extends BackupPolicyFixtureSubject {}

export function createSubject(
  fixture: {
    localData: BackupPolicyLocalDataFixture;
    explicitlyAllowedNonSensitiveKeys: readonly BackupPolicyLocalDataKey[];
  },
): AndroidBackupPolicyContractSubject {
  return createBackupPolicyFixtureSubject(fixture);
}

const localData: BackupPolicyLocalDataFixture = {
  firebaseAuthState: "firebase-user-credential",
  firebaseInstallationState: "firebase-installation-id",
  notificationEndpointBinding: "household-1/member-1/fid-1",
  sessionMirror: "household-1/member-1/session-1",
  legacyHouseholdKey: "legacy-household-key",
  legacyMemberIdentity: "legacy-member-name",
  webViewCookies: "session-cookie",
  webViewStorage: "financial-response",
  keystoreKeyMaterial: "non-exportable-key-material",
  captureQueueCiphertext: "encrypted-capture-entry",
  captureQueueMetadata: "capture-entry-metadata",
  quickEditQueueCiphertext: "encrypted-quick-edit-entry",
  quickEditQueueMetadata: "quick-edit-entry-metadata",
  quickEditPreference: false,
};

describe("Android backup·device transfer 기본 거부 공개 계약", () => {
  it.each(["cloud-backup", "device-transfer"] as const)(
    "[T-ANDROID-BACKUP-001][AND-009] $mode에는 비민감 allowlist 설정만 포함한다",
    (mode) => {
      const subject = createSubject({
        localData,
        explicitlyAllowedNonSensitiveKeys: ["quickEditPreference"],
      });

      expect(subject.createArtifact(mode)).toEqual({
        kind: "ArtifactCreated",
        mode,
        includedKeys: ["quickEditPreference"],
      });
      expect(subject.state()).toMatchObject({
        authenticatedActorPresent: true,
        pendingCaptureQueueEntries: 1,
      });
    },
  );

  it.each(["cloud-backup", "device-transfer"] as const)(
    "[T-ANDROID-BACKUP-001][AND-009] $mode 복원은 actor·credential·legacy·WebView·Queue를 새 설치로 가져오지 않는다",
    (mode) => {
      const subject = createSubject({
        localData,
        explicitlyAllowedNonSensitiveKeys: ["quickEditPreference"],
      });

      expect(subject.restoreOnFreshInstallation(mode)).toEqual({
        kind: "FreshUnauthenticatedInstallation",
        restored: { quickEditPreference: false },
        keystoreKeyRestored: false,
      });
      expect(subject.state()).toEqual({
        installation: { quickEditPreference: false },
        authenticatedActorPresent: false,
        pendingCaptureQueueEntries: 0,
      });
    },
  );

  it.each(["cloud-backup", "device-transfer"] as const)(
    "[T-ANDROID-BACKUP-001][AND-009] $mode 설정이 민감 key를 allowlist라고 잘못 표시해도 정책이 포함을 거부한다",
    (mode) => {
      const subject = createSubject({
        localData,
        explicitlyAllowedNonSensitiveKeys: [
          "firebaseAuthState",
          "firebaseInstallationState",
          "notificationEndpointBinding",
          "sessionMirror",
          "keystoreKeyMaterial",
          "captureQueueCiphertext",
          "quickEditQueueCiphertext",
          "quickEditPreference",
        ],
      });

      expect(subject.createArtifact(mode)).toEqual({
        kind: "ArtifactCreated",
        mode,
        includedKeys: ["quickEditPreference"],
      });
    },
  );

  it("[T-ANDROID-BACKUP-001][AND-009] 명시적으로 허용한 비민감 key가 없으면 새 설치에는 아무 로컬 상태도 복원하지 않는다", () => {
    const subject = createSubject({
      localData,
      explicitlyAllowedNonSensitiveKeys: [],
    });

    expect(subject.restoreOnFreshInstallation("cloud-backup")).toEqual({
      kind: "FreshUnauthenticatedInstallation",
      restored: {},
      keystoreKeyRestored: false,
    });
    expect(subject.state()).toEqual({
      installation: {},
      authenticatedActorPresent: false,
      pendingCaptureQueueEntries: 0,
    });
  });

  it("[T-ANDROID-BACKUP-001][AND-009] 허용된 비민감 key도 원본 설치에 값이 없으면 artifact에 빈 값으로 만들지 않는다", () => {
    const subject = createSubject({
      localData: { sessionMirror: "household-1/member-1/session-1" },
      explicitlyAllowedNonSensitiveKeys: ["quickEditPreference"],
    });

    expect(subject.createArtifact("device-transfer")).toEqual({
      kind: "ArtifactCreated",
      mode: "device-transfer",
      includedKeys: [],
    });
  });
});
