import { createAndroidNotificationPermissionApplication } from "../reference/android-host/application/androidNotificationPermissionApplication";

export function createNotificationPermissionFixture(fixture: {
  readonly previouslyDenied?: boolean;
  readonly canAskAgain?: boolean;
} = {}) {
  return createAndroidNotificationPermissionApplication(fixture);
}
