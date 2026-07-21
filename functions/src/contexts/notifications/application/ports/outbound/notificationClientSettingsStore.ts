export interface NotificationClientSettingsState {
  osNotificationPermission: "granted" | "denied";
  quickEditEnabled: boolean;
}

export interface NotificationClientSettingsStore {
  read(): NotificationClientSettingsState;
  save(state: NotificationClientSettingsState): void;
}
