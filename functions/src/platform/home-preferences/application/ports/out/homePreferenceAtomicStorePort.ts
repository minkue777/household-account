import type { HomeCardType } from "../../../domain/homeSummary";

export interface HomePreferenceCommandState {
  readonly householdId: string;
  readonly left: HomeCardType;
  readonly right: HomeCardType;
  readonly selectedLocalCurrencyType?: string;
  readonly aggregateVersion: number;
}

export interface HomePreferenceCommandMetadata {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly commandName: string;
  readonly payloadFingerprint: string;
  readonly householdId: string;
  readonly actorMemberId: string;
  readonly occurredAt: string;
}

export interface HomePreferenceMutation {
  readonly state: HomePreferenceCommandState;
  readonly value: Readonly<Record<string, never>>;
  readonly writes: boolean;
  readonly changedField?: "summary-cards" | "local-currency" | "auto-local-currency";
}

export type HomePreferenceAtomicResult =
  | { readonly kind: "committed" | "replayed"; readonly value: Readonly<Record<string, never>> }
  | { readonly kind: "payload-mismatch" }
  | { readonly kind: "commit-failed" };

export interface HomePreferenceAtomicStorePort {
  transact(
    metadata: HomePreferenceCommandMetadata,
    decide: (
      current: HomePreferenceCommandState,
      availableLocalCurrencyTypes: ReadonlySet<string>,
    ) => HomePreferenceMutation | { readonly kind: "rejected"; readonly code: string },
  ): Promise<
    | HomePreferenceAtomicResult
    | { readonly kind: "rejected"; readonly code: string }
  >;
}
