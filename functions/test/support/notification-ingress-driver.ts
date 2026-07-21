import {
  createNotificationIngress,
  type NotificationIngressInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  NotificationEnvelopeResult,
  NotificationEnvelopeView,
  NotificationIngressInputPort,
  NotificationIngressState,
  RawNotificationInput,
  RecentNotificationClaimInput,
  RecentNotificationDecision,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export function createNotificationIngressDriver(): NotificationIngressInputPort {
  return createNotificationIngress();
}
