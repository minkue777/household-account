import type {
  PwaPushHandlingResult,
  TrustedPwaPushNotification,
} from "../../../domain/model/pwaPushPayload";

export type {
  PwaPushContractFailureCode,
  PwaPushHandlingResult,
  PwaPushRouteKind,
  TrustedPwaNotificationRoute,
  TrustedPwaPushNotification,
  ValidatedPwaPushPayload,
} from "../../../domain/model/pwaPushPayload";

export interface PwaPushInputPort {
  receive(payload: unknown): Promise<PwaPushHandlingResult>;
}

export interface DisplayedPwaNotificationQuery {
  displayedNotifications(): readonly TrustedPwaPushNotification[];
}
