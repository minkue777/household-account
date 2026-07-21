export interface NotificationSettingsSnapshot {
  osNotificationPermission: "granted" | "denied";
  quickEditEnabled: boolean;
  serverSubscriptions: readonly never[];
}

export interface AndroidRecordedTransactionUx {
  push: { kind: "NoTarget"; reason: "ANDROID_USES_QUICK_EDIT" };
  localQuickEdit: "shown" | "suppressed-by-preference";
}

export interface NotificationVisibleSetting {
  id: "os-notification-permission" | "android-quick-edit";
  scope: "installation" | "android-local";
}

/** OS 표시 capability와 Android 로컬 Quick Edit 선호를 독립 관리합니다. */
export interface NotificationSettingsIndependenceInputPort {
  visibleSettings(): readonly NotificationVisibleSetting[];
  supportedServerCommands(): readonly string[];
  setOsNotificationPermission(permission: "granted" | "denied"): void;
  setQuickEditEnabled(enabled: boolean): void;
  handleAndroidRecordedTransaction(): AndroidRecordedTransactionUx;
  snapshot(): NotificationSettingsSnapshot;
}
