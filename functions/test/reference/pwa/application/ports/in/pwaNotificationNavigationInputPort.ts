import type { TrustedPwaNotificationRoute } from "../../../domain/model/pwaPushPayload";

export type PwaNotificationNavigationFailureCode =
  | "RAW_URL_NOT_ALLOWED"
  | "ROUTE_NOT_ALLOWED"
  | "INVALID_IDENTIFIER"
  | "PATH_TRAVERSAL"
  | "ROUTE_SHAPE_INVALID";

export type PwaNotificationNavigationResult =
  | {
      readonly kind: "Focused" | "Opened";
      readonly destination: string;
      readonly origin: string;
    }
  | {
      readonly kind: "Rejected";
      readonly code: PwaNotificationNavigationFailureCode;
    };

export interface PwaNotificationNavigationInputPort {
  navigate(input: {
    readonly route: TrustedPwaNotificationRoute;
  }): PwaNotificationNavigationResult;
}

export type { TrustedPwaNotificationRoute } from "../../../domain/model/pwaPushPayload";
