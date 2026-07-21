import type {
  DividendHoldingQuery,
  DividendHoldingTargetView,
  DividendPositionHistoryView,
} from "../../../../holdings/public";

export interface KindDividendDisclosure {
  readonly source: "KIND";
  readonly sourceDisclosureId: string;
  readonly disclosureState: "active" | "cancelled";
  readonly instrumentCode: string;
  readonly instrumentName: string;
  readonly recordDate: string;
  readonly paymentDate: string;
  readonly perShareAmount: number;
  readonly disclosedAt: string;
  readonly sourceReferenceHash: string;
}

export type KindDividendDiscoveryResult =
  | {
      readonly kind: "success";
      readonly disclosures: readonly KindDividendDisclosure[];
      readonly attempts: number;
    }
  | { readonly kind: "no-data"; readonly code: string; readonly attempts: number }
  | {
      readonly kind: "retryable-failure";
      readonly code: string;
      readonly attempts: number;
    }
  | {
      readonly kind: "contract-failure";
      readonly code: string;
      readonly attempts: number;
    };

export interface KindDividendDisclosurePort {
  discover(input: {
    readonly instrumentCode: string;
    readonly instrumentName: string;
    readonly periodFrom: string;
    readonly periodTo: string;
  }): Promise<KindDividendDiscoveryResult>;
}

export interface ScheduledDividendEvent {
  readonly documentId: string;
  readonly eventId: string;
  readonly householdId: string;
  readonly sourceDisclosureId: string;
  readonly sourceAssetIds: readonly string[];
  readonly instrumentCode: string;
  readonly instrumentName: string;
  readonly recordDate: string;
  readonly paymentDate: string;
  readonly perShareAmount: number;
  readonly status: "announced" | "fixed";
  readonly eligibleQuantity?: number;
  readonly totalAmount?: number;
  readonly aggregateVersion: number;
}

export type DividendAnnouncementUpsertResult =
  | {
      readonly kind: "created" | "changed";
      readonly eventId: string;
      readonly aggregateVersion: number;
    }
  | {
      readonly kind: "unchanged" | "paid-preserved";
      readonly eventId: string;
      readonly aggregateVersion: number;
    }
  | { readonly kind: "removed"; readonly eventId: string };

export interface DividendLifecycleEvidence {
  readonly assetId: string;
  readonly snapshotDate: string;
  readonly observedAt: string;
  readonly sourceVersion: string;
  readonly quantity: number;
  readonly selectionKind: "exact" | "nearest";
}

export type DividendTransitionResult =
  | {
      readonly kind: "changed";
      readonly eventId: string;
      readonly status: "fixed" | "paid";
      readonly aggregateVersion: number;
    }
  | { readonly kind: "unchanged"; readonly code: string };

export interface DividendEventRuntimeRepository {
  upsertAnnouncement(input: {
    readonly target: DividendHoldingTargetView;
    readonly disclosure: KindDividendDisclosure;
    readonly observedAt: string;
    readonly idempotencyKey: string;
  }): Promise<DividendAnnouncementUpsertResult>;

  listNonterminal(input: {
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly items: readonly ScheduledDividendEvent[];
    readonly nextCursor?: string;
  }>;

  transition(input: {
    readonly event: ScheduledDividendEvent;
    readonly targetStatus: "fixed" | "paid";
    readonly observedAt: string;
    readonly eligibleQuantity?: number;
    readonly evidence?: readonly DividendLifecycleEvidence[];
    readonly idempotencyKey: string;
  }): Promise<DividendTransitionResult>;

  rebuildAllAnnualProjections(input: {
    readonly sourceCheckpoint: string;
    readonly observedAt: string;
  }): Promise<{ readonly projectionCount: number }>;
}

export interface DividendProviderObservationPort {
  record(input: {
    readonly executionKey: string;
    readonly targetId: string;
    readonly resultKind:
      | "SUCCESS"
      | "NO_DATA"
      | "RETRYABLE_FAILURE"
      | "CONTRACT_FAILURE";
    readonly errorCode?: string;
    readonly attempts: number;
    readonly observedAt: string;
  }): Promise<void>;
}

export interface DividendScheduledRuntimeDependencies {
  readonly holdings: DividendHoldingQuery;
  readonly disclosures: KindDividendDisclosurePort;
  readonly events: DividendEventRuntimeRepository;
  readonly providerObservations: DividendProviderObservationPort;
}

export type {
  DividendHoldingQuery,
  DividendHoldingTargetView,
  DividendPositionHistoryView,
};
