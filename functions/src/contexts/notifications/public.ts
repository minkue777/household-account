import {
  createDefaultNotificationTargetPlanner,
  NotificationTargetPlanner,
} from "./application/planNotificationTargets";

export type {
  EndpointFact,
  HouseholdNotificationRequestedInput,
  MemberFact,
  MobileEndpointPlatform,
  NotificationTarget,
  NotificationTargetDecision,
  TransactionRecordedNotificationInput,
} from "./domain/model/notificationTarget";

export type { NotificationTargetPlanner };

export function createNotificationTargetPlanner(): NotificationTargetPlanner {
  return createDefaultNotificationTargetPlanner();
}

export {
  type ClientCapabilityResult,
  type ClientEndpointResult,
  type MobileEndpointDeviceInfo,
  type MobileFidRegistrationInputPort,
  type MobilePlatform,
  type MobileRuntime,
  type MobileSessionScope,
  type RegisterMobileFidInput,
  type UnregisterMobileFidInput,
} from "./application/ports/in/mobileFidRegistrationPort";

export {
  type EndpointClientCapabilityResult,
  type EndpointLifecycleInputPort,
  type EndpointView,
  type MarkEndpointInactiveCommand,
  type MarkEndpointInactiveResult,
  type RegisterEndpointCommand,
  type RegisterEndpointResult,
  type RemoveEndpointCommand,
  type RemoveEndpointResult,
} from "./application/ports/in/endpointLifecyclePort";

export {
  type ExplicitNotificationRequest,
  type ExplicitRequestResult,
  type HouseholdDeliveryStatusQueryResult,
  type HouseholdMemberRemovedEvent,
  type MemberCleanupResult,
  type NotificationsSecurityBoundaryInputPort,
  type Principal,
  type PublicEndpointView,
  type SecuredRegisterEndpointCommand,
  type SecuredRegisterEndpointResult,
  type SecuredRemoveEndpointInput,
  type SecuredRemoveEndpointResult,
  type TerminalDeliveryView,
} from "./application/ports/in/notificationSecurityBoundaryPort";

export {
  type AcceptDuplicateNotificationResult,
  type CaptureDuplicateNotificationInputPort,
  type CaptureDuplicateObservedEvent,
  type DeliverDuplicateNotificationResult,
} from "./application/ports/in/captureDuplicateNotificationPort";

export {
  type ShortcutTransactionNotificationInputPort,
  type ShortcutTransactionNotificationResult,
  type ShortcutTransactionRecordedEvent,
} from "./application/ports/in/shortcutTransactionNotificationPort";

export {
  type AcceptNotificationIntentResult,
  type DeliverNotificationResult,
  type DeliveryAssuranceInputPort,
  type DeliveryItemView,
  type DeliveryStatusView,
  type HouseholdNotificationRequestedEvent,
  type NotificationInboxStatusView,
  type PublicEndpointStatusView,
} from "./application/ports/in/deliveryAssurancePort";

export {
  type DeliveryReconciliationInputPort,
  type ReconcileDeliveryResult,
} from "./application/ports/in/deliveryReconciliationPort";

export {
  type AndroidRecordedTransactionUx,
  type NotificationSettingsIndependenceInputPort,
  type NotificationSettingsSnapshot,
  type NotificationVisibleSetting,
} from "./application/ports/in/notificationSettingsIndependencePort";

export {
  type NotificationClickInput,
  type NotificationClickResult,
  type NotificationClientView,
  type SafeNotificationClickInputPort,
} from "./application/ports/in/safeNotificationClickPort";

export {
  type AndroidForegroundNotificationInputPort,
  type AndroidForegroundPayload,
  type AndroidForegroundResult,
  type AndroidPostNotificationsPermission,
} from "./application/ports/in/androidForegroundNotificationPort";

export {
  type LifecycleSignalResult,
  type NotificationHouseholdPurgeInputPort,
  type NotificationPurgePageResult,
  type NotificationPurgeSystemActor,
} from "./application/ports/in/notificationHouseholdPurgePort";
