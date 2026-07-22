export const RUNTIME_MIGRATION_KIND =
  "legacy-runtime-to-household-canonical-v1" as const;
export const RUNTIME_MIGRATION_SCHEMA_SCOPE =
  "legacy-flat-v1:household-canonical-v1" as const;

export type RuntimeMigrationCandidateAction = "create" | "merge-missing";

export interface RuntimeMigrationScope {
  readonly projectId: string;
  readonly householdId: string;
  readonly migrationId: string;
  readonly migrationKind: typeof RUNTIME_MIGRATION_KIND;
  readonly schemaScope: typeof RUNTIME_MIGRATION_SCHEMA_SCOPE;
  readonly operatorId: string;
}

export interface RuntimeMigrationMappingManifest {
  readonly version: 1;
  /** SHA-256 of the raw household id. The raw id must not be copied into a file. */
  readonly householdIdHash: string;
  readonly memberReferences?: Readonly<Record<string, string>>;
  /**
   * Operator-confirmed member used only when a legacy ledger transaction or
   * recurring plan has no creator value at all. Existing creator values are
   * never replaced by this fallback.
   */
  readonly missingCreatorMemberId?: string;
  readonly ledgerCreators?: Readonly<Record<string, string>>;
  readonly ledgerNotificationRequesters?: Readonly<Record<string, string>>;
  readonly recurringCreators?: Readonly<Record<string, string>>;
  readonly registeredCardOwners?: Readonly<Record<string, string>>;
  readonly merchantRulePriorities?: Readonly<Record<string, number>>;
  readonly assetOwners?: Readonly<Record<string, string>>;
  readonly positionAssets?: Readonly<Record<string, string>>;
  readonly positionMarkets?: Readonly<
    Record<string, "KRX" | "US" | "KOFIA_FUND" | "UNRESOLVED">
  >;
  readonly assetAutomationFirstApplicableMonths?: Readonly<
    Record<string, string>
  >;
  readonly localCurrencyTypes?: Readonly<
    Record<string, "gyeonggi" | "daejeon" | "sejong">
  >;
  readonly localCurrencyPreferredDocuments?: Readonly<Record<string, string>>;
  readonly homeSelectedLocalCurrencyType?: "gyeonggi" | "daejeon" | "sejong";
  readonly defaultCategoryId?: string;
}

export type RuntimeMigrationUnresolvedCode =
  | "LEGACY_MEMBER_MAPPING_REQUIRED"
  | "LEDGER_CREATOR_MAPPING_REQUIRED"
  | "LEDGER_NOTIFICATION_REQUESTER_MAPPING_REQUIRED"
  | "RECURRING_CREATOR_MAPPING_REQUIRED"
  | "ASSET_OWNER_MAPPING_REQUIRED"
  | "ASSET_OWNER_PROFILE_NOT_FOUND"
  | "POSITION_ASSET_MAPPING_REQUIRED"
  | "POSITION_MARKET_MAPPING_REQUIRED"
  | "CATEGORY_DEFAULT_MAPPING_REQUIRED"
  | "ASSET_AUTOMATION_START_MONTH_REQUIRED"
  | "REGISTERED_CARD_OWNER_MAPPING_REQUIRED"
  | "REGISTERED_CARD_IDENTITY_CONFLICT"
  | "MERCHANT_RULE_CLAIM_CONFLICT"
  | "MERCHANT_RULE_PRIORITY_MAPPING_REQUIRED"
  | "LOCAL_CURRENCY_TYPE_MAPPING_REQUIRED"
  | "LOCAL_CURRENCY_DUPLICATE_SELECTION_REQUIRED"
  | "HOME_LOCAL_CURRENCY_SELECTION_MAPPING_REQUIRED"
  | "SOURCE_DOCUMENT_INVALID"
  | "CANONICAL_TARGET_CONFLICT";

export interface RuntimeMigrationUnresolved {
  readonly code: RuntimeMigrationUnresolvedCode;
  readonly sourceCollection: string;
  readonly referenceHash: string;
  readonly requiredManifestField?: string;
  readonly detailCode?: string;
}

export interface RuntimeMigrationCandidate {
  readonly index: number;
  readonly candidateId: string;
  readonly sourcePath: string;
  readonly sourceFingerprint: string;
  readonly targetPath: string;
  readonly targetData: Readonly<Record<string, unknown>>;
  readonly action: RuntimeMigrationCandidateAction;
  readonly decisionHash: string;
  readonly amountInWon: number;
  readonly logicalCollection:
    | "ledger"
    | "asset"
    | "category"
    | "category-setting"
    | "recurring"
    | "recurring-creator-receipt"
    | "position"
    | "asset-automation-plan"
    | "asset-automation-revision"
    | "registered-card"
    | "registered-card-claim"
    | "merchant-rule"
    | "merchant-rule-claim"
    | "local-currency-balance"
    | "home-preference";
}

export interface RuntimeMigrationReconciliationSummary {
  readonly count: number;
  readonly amountInWon: number;
  readonly decisionHash: string;
}

export interface RuntimeMigrationPlanMaterial {
  readonly scope: RuntimeMigrationScope;
  readonly mappingManifestHash: string;
  readonly sourceSummary: RuntimeMigrationReconciliationSummary;
  readonly expectedTargetSummary: RuntimeMigrationReconciliationSummary;
  readonly candidates: readonly RuntimeMigrationCandidate[];
  readonly unresolved: readonly RuntimeMigrationUnresolved[];
}

export interface PersistedRuntimeMigrationPlan {
  readonly planHash: string;
  readonly scope: RuntimeMigrationScope;
  readonly mappingManifestHash: string;
  readonly sourceSummary: RuntimeMigrationReconciliationSummary;
  readonly expectedTargetSummary: RuntimeMigrationReconciliationSummary;
  readonly candidateCount: number;
  readonly unresolvedCount: number;
  readonly unresolvedDecisionHash: string;
  readonly status: "blocked" | "planned" | "applying" | "completed" | "failed";
  readonly nextIndex: number;
  readonly checkpoint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type RuntimeMigrationDryRunResult = {
  readonly kind: "dry-run";
  readonly planHash: string;
  readonly scopeHash: string;
  readonly candidateCount: number;
  readonly unresolved: readonly RuntimeMigrationUnresolved[];
  readonly sourceSummary: RuntimeMigrationReconciliationSummary;
  readonly expectedTargetSummary: RuntimeMigrationReconciliationSummary;
  readonly checkpoint: string;
};

export type RuntimeMigrationApplyResult =
  | {
      readonly kind: "applied";
      readonly planHash: string;
      readonly checkpoint: string;
      readonly appliedPages: number;
      readonly replayedPages: number;
      readonly reconciliation: {
        readonly source: RuntimeMigrationReconciliationSummary;
        readonly expectedTarget: RuntimeMigrationReconciliationSummary;
        readonly actualTarget: RuntimeMigrationReconciliationSummary;
        readonly status: "MATCH";
      };
    }
  | {
      readonly kind: "checkpoint";
      readonly planHash: string;
      readonly checkpoint: string;
      readonly appliedPages: number;
      readonly replayedPages: number;
      readonly remainingCandidates: number;
    }
  | {
      readonly kind: "blocked";
      readonly code:
        | "EXPLICIT_CONFIRMATION_REQUIRED"
        | "MIGRATION_PLAN_NOT_FOUND"
        | "MIGRATION_SCOPE_MISMATCH"
        | "MIGRATION_PLAN_HASH_MISMATCH"
        | "MIGRATION_CHECKPOINT_MISMATCH"
        | "MIGRATION_UNRESOLVED_REFERENCES"
        | "MIGRATION_SOURCE_CHANGED"
        | "MIGRATION_TARGET_CONFLICT"
        | "MIGRATION_RECONCILIATION_MISMATCH";
      readonly planHash?: string;
      readonly checkpoint?: string;
      readonly unresolved?: readonly RuntimeMigrationUnresolved[];
    };

export interface RuntimeMigrationPlanBuilderPort {
  build(input: {
    readonly scope: RuntimeMigrationScope;
    readonly mappings: RuntimeMigrationMappingManifest;
    readonly plannedAt: string;
  }): Promise<RuntimeMigrationPlanMaterial>;
}

export interface RuntimeMigrationPersistencePort {
  persistDryRun(input: {
    readonly material: RuntimeMigrationPlanMaterial;
    readonly planHash: string;
    readonly plannedAt: string;
  }): Promise<PersistedRuntimeMigrationPlan>;
  loadPlan(planHash: string): Promise<PersistedRuntimeMigrationPlan | undefined>;
  loadUnresolved(planHash: string): Promise<readonly RuntimeMigrationUnresolved[]>;
  applyNextPage(input: {
    readonly plan: PersistedRuntimeMigrationPlan;
    readonly pageSize: number;
    readonly appliedAt: string;
  }): Promise<
    | {
        readonly kind: "page-applied" | "page-replayed";
        readonly plan: PersistedRuntimeMigrationPlan;
      }
    | {
        readonly kind: "blocked";
        readonly code: "MIGRATION_SOURCE_CHANGED" | "MIGRATION_TARGET_CONFLICT";
        readonly checkpoint: string;
      }
  >;
  reconcile(plan: PersistedRuntimeMigrationPlan): Promise<
    | {
        readonly kind: "match";
        readonly actual: RuntimeMigrationReconciliationSummary;
        readonly plan: PersistedRuntimeMigrationPlan;
      }
    | {
        readonly kind: "mismatch";
        readonly actual: RuntimeMigrationReconciliationSummary;
      }
  >;
}
