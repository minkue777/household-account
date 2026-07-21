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

export interface RecentNotificationClaimInput {
  readonly packageName: string;
  readonly parseText: string;
  readonly receivedAtMilliseconds: number;
}

export type RecentNotificationDecision =
  | { readonly kind: "Accepted" }
  | { readonly kind: "Duplicate"; readonly ageInMilliseconds: number };

export interface RecentNotificationEntry {
  readonly packageName: string;
  readonly parseText: string;
  readonly acceptedAtMilliseconds: number;
}

export interface NotificationIngressState {
  readonly recentEntries: readonly RecentNotificationEntry[];
}
