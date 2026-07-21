export interface AndroidComponentName {
  readonly packageName: string;
  readonly className: string;
}

export interface AndroidPermissionState {
  readonly notificationListenerComponent: AndroidComponentName;
  readonly enabledNotificationListenerComponents: readonly AndroidComponentName[];
  readonly canDrawOverlays: boolean;
  readonly quickEditEnabled: boolean;
}

export type AndroidHostAccessDecision =
  | { readonly kind: "ShowWebShell" }
  | {
      readonly kind: "ShowPermissionGuide";
      readonly notificationAccess: "granted" | "missing";
      readonly overlay: "granted" | "missing";
      readonly actions: readonly (
        | "OPEN_NOTIFICATION_LISTENER_SETTINGS"
        | "OPEN_OVERLAY_SETTINGS"
      )[];
    };

export interface AndroidHostAccessInputPort {
  decide(state: AndroidPermissionState): AndroidHostAccessDecision;
}
