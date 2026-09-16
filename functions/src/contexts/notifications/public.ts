import {
  createDefaultNotificationTargetPlanner,
  NotificationTargetPlanner,
} from "./application/planNotificationTargets";

export { createNotificationHouseholdPurgeApplication } from "./application/notificationHouseholdPurgeApplication";

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
  type LifecycleSignalResult,
  type NotificationHouseholdPurgeInputPort,
  type NotificationPurgePageResult,
  type NotificationPurgeSystemActor,
} from "./application/ports/in/notificationHouseholdPurgePort";
