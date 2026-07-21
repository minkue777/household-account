import { createAndroidBackupPolicyApplication } from "../reference/android-host/application/androidBackupPolicyApplication";
import type {
  AndroidBackupPolicyInputPort,
  AndroidLocalDataKey,
  AndroidLocalDataSnapshot,
} from "../reference/android-host/application/ports/in/androidBackupPolicyInputPort";

export type BackupPolicyLocalDataFixture = AndroidLocalDataSnapshot;
export type BackupPolicyLocalDataKey = AndroidLocalDataKey;
export interface BackupPolicyFixtureSubject
  extends AndroidBackupPolicyInputPort {}

export function createBackupPolicyFixtureSubject(input: {
  readonly localData: BackupPolicyLocalDataFixture;
  readonly explicitlyAllowedNonSensitiveKeys: readonly BackupPolicyLocalDataKey[];
}): BackupPolicyFixtureSubject {
  return createAndroidBackupPolicyApplication(input);
}
