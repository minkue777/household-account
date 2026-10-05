export interface RawNotificationInput {
  readonly packageName: string;
  readonly postedAt: string;
  readonly title?: string | null;
  readonly text?: string | null;
  readonly bigText?: string | null;
  readonly textLines?: readonly string[];
}

export interface NotificationEnvelopeView {
  readonly packageName: string;
  readonly postedAt: string;
  readonly selectedBody: string;
  readonly parseText: string;
}

export type NotificationEnvelopeResult =
  | { readonly kind: "Built"; readonly envelope: NotificationEnvelopeView }
  | { readonly kind: "Ignored"; readonly code: "EMPTY_NOTIFICATION" };
