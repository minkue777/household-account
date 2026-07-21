export type PwaPushRouteKind = "expense" | "asset";

/** Push 검증 뒤 표시와 클릭 Application이 함께 사용하는 유일한 route DTO입니다. */
export interface TrustedPwaNotificationRoute {
  readonly kind: PwaPushRouteKind;
  readonly identifier: string;
}

export interface ValidatedPwaPushPayload {
  readonly version: "notification.v1";
  readonly notificationId: string;
  readonly title: string;
  readonly body: string;
  readonly route: TrustedPwaNotificationRoute;
}

export type PwaPushContractFailureCode =
  | "VERSION_UNSUPPORTED"
  | "REQUIRED_FIELD_MISSING"
  | "FIELD_TYPE_INVALID"
  | "ROUTE_NOT_ALLOWED";

export type PwaPushPayloadDecision =
  | { readonly kind: "Valid"; readonly payload: ValidatedPwaPushPayload }
  | {
      readonly kind: "Rejected";
      readonly code: PwaPushContractFailureCode;
    };

export interface TrustedPwaPushNotification {
  readonly notificationId: string;
  readonly title: string;
  readonly body: string;
  readonly route: TrustedPwaNotificationRoute;
  readonly navigation: {
    readonly origin: string;
    readonly destination: string;
  };
}

export type PwaPushHandlingResult =
  | { readonly kind: "Displayed"; readonly notificationId: string }
  | {
      readonly kind: "Rejected";
      readonly code: PwaPushContractFailureCode;
    };
