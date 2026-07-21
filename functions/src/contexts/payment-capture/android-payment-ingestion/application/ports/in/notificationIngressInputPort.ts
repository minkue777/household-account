import type {
  NotificationEnvelopeResult,
  NotificationIngressState,
  RawNotificationInput,
  RecentNotificationClaimInput,
  RecentNotificationDecision,
} from "../../../domain/model/notificationIngress";

export interface NotificationIngressInputPort {
  buildEnvelope(input: RawNotificationInput): NotificationEnvelopeResult;
  claimRecent(
    input: RecentNotificationClaimInput,
  ): RecentNotificationDecision;
  restartProcess(): void;
  state(): NotificationIngressState;
}
