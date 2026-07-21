export interface DividendDisclosure {
  source: "KIND";
  sourceDisclosureId: string;
  correctsSourceDisclosureId?: string;
  disclosureState: "active" | "cancelled";
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
}

export interface PositionSnapshot {
  assetId: string;
  instrumentCode: string;
  snapshotDate: string;
  quantity: number;
  observedAt: string;
  sourceVersion: string;
}

export interface DividendEligibilityContribution {
  assetId: string;
  quantity: number;
  kind: "record-date-position" | "nearest-position-snapshot";
  snapshotDate: string;
  sourceVersion: string;
}

export interface DividendEventView {
  eventId: string;
  sourceDisclosureId: string;
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: "announced" | "fixed" | "paid";
  eligibleQuantity?: number;
  totalAmount?: number;
  paidAt?: string;
  eligibilityContributions?: readonly DividendEligibilityContribution[];
}

export interface StoredDividendEvent extends DividendEventView {
  householdId: string;
  aggregateVersion: number;
  disclosureAliases: readonly string[];
}

export type DividendCommandResult =
  | { kind: "success"; event?: DividendEventView; removedEventId?: string }
  | { kind: "no-change"; code: string }
  | {
      kind: "already-processed";
      code: "PAID_DIVIDEND_IMMUTABLE";
      eventId: string;
    }
  | { kind: "no-data"; code: string }
  | { kind: "retryable-failure"; code: string };

export type DividendIntegrationEvent =
  | {
      eventType: "DividendEventChanged.v1";
      aggregateId: string;
      aggregateVersion: number;
    }
  | {
      eventType: "DividendEventRemoved.v1";
      aggregateId: string;
      reason: "DISCLOSURE_CANCELLED";
    };

export interface AnnualDividendProjection {
  monthlyAmounts: readonly number[];
  events: Readonly<Record<string, DividendEventView>>;
}
