import type {
  AndroidCapabilityState,
  AndroidNotificationPermissionInputPort,
} from "./ports/in/androidNotificationPermissionInputPort";

export function createAndroidNotificationPermissionApplication(fixture: {
  readonly previouslyDenied?: boolean;
  readonly canAskAgain?: boolean;
} = {}): AndroidNotificationPermissionInputPort {
  const canAskAgain = fixture.canAskAgain ?? false;
  let display: AndroidCapabilityState["notificationDisplay"] =
    fixture.previouslyDenied ? "denied" : "unknown";
  let nextAction: AndroidCapabilityState["nextPermissionAction"] =
    fixture.previouslyDenied && !canAskAgain ? "settings-only" : "request-dialog";

  return {
    request(input) {
      if (input.apiLevel <= 32) {
        display = "not-required";
        nextAction = "none";
        return { kind: "NotRequired" };
      }
      if (fixture.previouslyDenied && !canAskAgain) {
        display = "denied";
        nextAction = "settings-only";
        return { kind: "SettingsOnly" };
      }
      if (!input.userInitiated || input.osOutcome === undefined) {
        nextAction = "request-dialog";
        return { kind: "DeferredUntilUserAction" };
      }
      if (input.osOutcome === "granted") {
        display = "granted";
        nextAction = "none";
        return { kind: "Granted", dialogShown: true };
      }
      display = "denied";
      nextAction = canAskAgain ? "request-dialog" : "settings-only";
      return {
        kind: "Denied",
        dialogShown: true,
        repeatDialogAllowed: canAskAgain,
      };
    },
    state() {
      return {
        webShellAvailable: true,
        notificationCaptureAvailable: true,
        quickEditAvailable: true,
        fidRegistrationAvailable: true,
        notificationDisplay: display,
        nextPermissionAction: nextAction,
      };
    },
  };
}
