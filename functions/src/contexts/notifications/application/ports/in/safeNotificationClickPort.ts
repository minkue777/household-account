export interface NotificationClientView {
  clientId: string;
  url: string;
  visibilityState: "visible" | "hidden";
}

export interface NotificationClickInput {
  action: "default" | "dismiss";
  applicationOrigin: string;
  payload: Readonly<Record<string, unknown>>;
  clients: readonly NotificationClientView[];
}

export type NotificationClickResult =
  | { kind: "focused"; clientId: string; url: string }
  | { kind: "opened"; url: string }
  | {
      kind: "no-navigation";
      reason:
        | "DISMISSED"
        | "INVALID_PAYLOAD"
        | "UNSUPPORTED_PAYLOAD_VERSION"
        | "UNSUPPORTED_CLICK_TARGET";
    };

/** 신뢰하지 않는 알림 payload를 검증해 same-origin 이동만 허용합니다. */
export interface SafeNotificationClickInputPort {
  handleNotificationClick(
    input: NotificationClickInput,
  ): Promise<NotificationClickResult>;
}
