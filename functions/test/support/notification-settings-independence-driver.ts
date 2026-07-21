import { createNotificationSettingsIndependenceApplication } from "../../src/contexts/notifications/application/notificationSettingsIndependenceApplication";
import type {
  NotificationClientSettingsState,
  NotificationClientSettingsStore,
} from "../../src/contexts/notifications/application/ports/outbound/notificationClientSettingsStore";
import {
  createNotificationTargetPlanner,
  type NotificationSettingsIndependenceInputPort,
} from "../../src/contexts/notifications/public";

export interface EndpointLifecycleMutationCall {
  operation: "RegisterEndpoint" | "RemoveEndpoint" | "MarkEndpointInactive";
}

export interface NotificationSettingsIndependenceFixtureSubject
  extends NotificationSettingsIndependenceInputPort {
  endpointLifecycleMutationCalls(): readonly EndpointLifecycleMutationCall[];
}

class FixtureNotificationClientSettingsStore
  implements NotificationClientSettingsStore
{
  private state: NotificationClientSettingsState = {
    osNotificationPermission: "granted",
    quickEditEnabled: true,
  };

  read(): NotificationClientSettingsState {
    return { ...this.state };
  }

  save(state: NotificationClientSettingsState): void {
    this.state = { ...state };
  }
}

export function createNotificationSettingsIndependenceFixtureSubject(): NotificationSettingsIndependenceFixtureSubject {
  const input = createNotificationSettingsIndependenceApplication(
    createNotificationTargetPlanner(),
    new FixtureNotificationClientSettingsStore(),
  );
  return {
    visibleSettings: () => input.visibleSettings(),
    supportedServerCommands: () => input.supportedServerCommands(),
    setOsNotificationPermission: (permission) =>
      input.setOsNotificationPermission(permission),
    setQuickEditEnabled: (enabled) => input.setQuickEditEnabled(enabled),
    handleAndroidRecordedTransaction: () =>
      input.handleAndroidRecordedTransaction(),
    snapshot: () => input.snapshot(),
    endpointLifecycleMutationCalls: () => [],
  };
}
