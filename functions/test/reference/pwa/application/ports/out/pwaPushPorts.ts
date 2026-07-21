import type {
  PwaPushContractFailureCode,
  TrustedPwaPushNotification,
} from "../../../domain/model/pwaPushPayload";

export interface PwaNotificationDisplayPort {
  display(notification: TrustedPwaPushNotification): Promise<void>;
}

export interface PwaPushTelemetryPort {
  recordContractFailure(code: PwaPushContractFailureCode): void;
}
