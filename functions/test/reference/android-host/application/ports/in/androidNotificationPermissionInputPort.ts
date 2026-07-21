export interface AndroidCapabilityState {
  readonly webShellAvailable: boolean;
  readonly notificationCaptureAvailable: boolean;
  readonly quickEditAvailable: boolean;
  readonly fidRegistrationAvailable: boolean;
  readonly notificationDisplay: "granted" | "denied" | "not-required" | "unknown";
  readonly nextPermissionAction: "request-dialog" | "settings-only" | "none";
}

export type NotificationPermissionResult =
  | { readonly kind: "NotRequired" }
  | { readonly kind: "Granted"; readonly dialogShown: boolean }
  | {
      readonly kind: "Denied";
      readonly dialogShown: boolean;
      readonly repeatDialogAllowed: boolean;
    }
  | { readonly kind: "DeferredUntilUserAction" }
  | { readonly kind: "SettingsOnly" };

export interface AndroidNotificationPermissionInputPort {
  request(input: {
    readonly apiLevel: number;
    readonly userInitiated: boolean;
    readonly osOutcome?: "granted" | "denied";
  }): NotificationPermissionResult;
  state(): AndroidCapabilityState;
}
