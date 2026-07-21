import type {
  AndroidRecordedTransactionUx,
  NotificationSettingsIndependenceInputPort,
  NotificationSettingsSnapshot,
  NotificationVisibleSetting,
} from "./ports/in/notificationSettingsIndependencePort";
import type { NotificationClientSettingsStore } from "./ports/outbound/notificationClientSettingsStore";
import type { NotificationTargetPlanner } from "./planNotificationTargets";

const VISIBLE_SETTINGS: readonly NotificationVisibleSetting[] = [
  { id: "os-notification-permission", scope: "installation" },
  { id: "android-quick-edit", scope: "android-local" },
];

const SUPPORTED_SERVER_COMMANDS: readonly string[] = [
  "RegisterEndpoint",
  "RemoveEndpoint",
];

class DefaultNotificationSettingsIndependenceApplication
  implements NotificationSettingsIndependenceInputPort
{
  constructor(
    private readonly planner: NotificationTargetPlanner,
    private readonly settings: NotificationClientSettingsStore,
  ) {}

  visibleSettings(): readonly NotificationVisibleSetting[] {
    return VISIBLE_SETTINGS.map((setting) => ({ ...setting }));
  }

  supportedServerCommands(): readonly string[] {
    return [...SUPPORTED_SERVER_COMMANDS];
  }

  setOsNotificationPermission(permission: "granted" | "denied"): void {
    this.settings.save({
      ...this.settings.read(),
      osNotificationPermission: permission,
    });
  }

  setQuickEditEnabled(enabled: boolean): void {
    this.settings.save({
      ...this.settings.read(),
      quickEditEnabled: enabled,
    });
  }

  handleAndroidRecordedTransaction(): AndroidRecordedTransactionUx {
    const push = this.planner.forRecordedTransaction({
      eventId: "local-android-recorded-transaction",
      householdId: "local-household",
      transactionId: "local-transaction",
      transactionType: "expense",
      originChannel: "android-notification",
      creatorMemberId: "local-member",
      members: [],
      endpoints: [],
    });
    if (
      push.kind !== "NoTarget" ||
      push.reason !== "ANDROID_USES_QUICK_EDIT"
    ) {
      throw new Error("Android transaction push policy contract changed");
    }

    return {
      push: { kind: "NoTarget", reason: "ANDROID_USES_QUICK_EDIT" },
      localQuickEdit: this.settings.read().quickEditEnabled
        ? "shown"
        : "suppressed-by-preference",
    };
  }

  snapshot(): NotificationSettingsSnapshot {
    return {
      ...this.settings.read(),
      serverSubscriptions: [],
    };
  }
}

export function createNotificationSettingsIndependenceApplication(
  planner: NotificationTargetPlanner,
  settings: NotificationClientSettingsStore,
): NotificationSettingsIndependenceInputPort {
  return new DefaultNotificationSettingsIndependenceApplication(
    planner,
    settings,
  );
}
