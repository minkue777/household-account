import type { AssetOwnerRef, AssetType } from "../../../domain/model/assetCreation";
import type { QuoteObservation } from "../../../../holdings/public";

export type PortfolioLifecycleState = "active" | "deleted" | "purging";
export type PortfolioPositionKind = "stock" | "crypto";

export interface PortfolioOwnerProfileReference {
  readonly profileId: string;
  readonly householdId: string;
  readonly displayName: string;
  readonly lifecycleState: "active" | "archived";
}

export interface PortfolioAssetAutomationFields {
  readonly recurringContributionAmount: number;
  readonly recurringContributionDay: number;
  readonly lastAutoContributionMonth: string;
  readonly loanInterestRate: number;
  readonly loanRepaymentMethod: string;
  readonly loanMonthlyPaymentAmount: number;
  readonly loanPaymentDay: number;
  readonly lastAutoRepaymentMonth: string;
}

export interface PortfolioRuntimeAsset {
  readonly assetId: string;
  readonly householdId: string;
  readonly name: string;
  readonly type: AssetType;
  readonly subType?: string;
  /** Legacy Web projection keeps its localized value until the read side migrates. */
  readonly legacySubType?: string;
  readonly ownerRef: AssetOwnerRef;
  readonly ownerDisplayName: string;
  readonly currency: "KRW" | "USD";
  readonly currentBalance: number;
  readonly costBasis?: number;
  readonly memo: string;
  readonly order: number;
  readonly lifecycleState: PortfolioLifecycleState;
  readonly aggregateVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
  readonly initialInvestment?: number;
  readonly quantity?: number;
  readonly stockCode?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly automation: PortfolioAssetAutomationFields;
}

export interface PortfolioRuntimePosition {
  readonly positionId: string;
  readonly householdId: string;
  readonly assetId: string;
  readonly positionKind: PortfolioPositionKind;
  readonly instrumentCode: string;
  readonly instrumentName: string;
  readonly instrumentType:
    | "stock"
    | "etf"
    | "etn"
    | "fund"
    | "bond"
    | "cash"
    | "manual"
    | "crypto";
  readonly market:
    | "KRX"
    | "US"
    | "KOFIA_FUND"
    | "UPBIT_KRW"
    | "UNRESOLVED";
  readonly exchange?: "KOSPI" | "KOSDAQ" | "KONEX" | "NASDAQ" | "NYSE" | "AMEX";
  readonly currency: "KRW" | "USD";
  readonly holdingType?: "stock" | "bond" | "cash" | "manual";
  readonly quantity: number;
  readonly averagePriceInWon: number;
  readonly priceScale: number;
  readonly lastQuote?: QuoteObservation;
  readonly quoteAsOf?: string;
  readonly aggregateVersion: number;
  readonly lifecycleState: "active" | "deleted";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PortfolioRuntimeAutomationPlan {
  readonly planId: string;
  readonly householdId: string;
  readonly assetId: string;
  readonly operation: "savings-contribution" | "loan-repayment";
  readonly kind: "savings-deposit" | "loan-repayment";
  readonly status: "active" | "suspended" | "needs-attention";
  readonly amountInWon: number;
  readonly configuredDay: number;
  readonly firstActivatedOn: string;
  readonly activationMonthDisposition: "included" | "applicable";
  readonly firstApplicableMonth: string;
  readonly nextDueDate: string;
  readonly lastAppliedMonth?: string;
  readonly repaymentMethod?: string;
  readonly annualInterestRate?: number;
  readonly currentRevision: number;
  readonly aggregateVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PortfolioRuntimeState {
  readonly assets: readonly PortfolioRuntimeAsset[];
  readonly positions: readonly PortfolioRuntimePosition[];
  readonly ownerProfiles: readonly PortfolioOwnerProfileReference[];
  readonly automationPlans: readonly PortfolioRuntimeAutomationPlan[];
}

export interface PortfolioCommandMetadata {
  readonly householdId: string;
  readonly principalUid: string;
  readonly actorMemberId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly commandName: string;
  readonly payloadFingerprint: string;
  readonly occurredAt: string;
}

export type PortfolioCommandResult =
  | {
      readonly kind: "success";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "error";
      readonly code: string;
      readonly retryable?: boolean;
    };

export interface PortfolioRuntimeEvent {
  readonly eventType:
    | "AssetValuationChanged.v1"
    | "AssetLifecycleChanged.v1"
    | "PositionChanged.v1";
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PortfolioRuntimeMutation {
  readonly writes: boolean;
  readonly state: PortfolioRuntimeState;
  readonly events: readonly PortfolioRuntimeEvent[];
  readonly value: PortfolioCommandResult;
}

export type PortfolioAtomicResult =
  | { readonly kind: "committed"; readonly value: PortfolioCommandResult }
  | { readonly kind: "replayed"; readonly value: PortfolioCommandResult }
  | { readonly kind: "payload-mismatch" }
  | { readonly kind: "commit-failed" };

export type PortfolioRefreshLeaseResult =
  | { readonly kind: "acquired" }
  | { readonly kind: "busy" }
  | { readonly kind: "replayed"; readonly value: PortfolioCommandResult }
  | { readonly kind: "payload-mismatch" }
  | { readonly kind: "failed" };

export interface PortfolioRuntimeStorePort {
  transact(
    metadata: PortfolioCommandMetadata,
    decide: (state: PortfolioRuntimeState) => PortfolioRuntimeMutation,
  ): Promise<PortfolioAtomicResult>;

  readState(householdId: string): Promise<PortfolioRuntimeState>;

  acquireRefreshLease(
    metadata: PortfolioCommandMetadata,
    scopeKey: string,
  ): Promise<PortfolioRefreshLeaseResult>;

  releaseRefreshLease(
    metadata: PortfolioCommandMetadata,
    scopeKey: string,
  ): Promise<void>;
}

export interface PortfolioMarketTarget {
  readonly targetKey: string;
  readonly assetId: string;
  readonly positionId?: string;
  readonly kind: "stock" | "crypto" | "physical-gold";
  readonly market:
    | "KRX"
    | "US"
    | "KOFIA_FUND"
    | "UPBIT_KRW"
    | "PHYSICAL_GOLD";
  readonly instrumentCode: string;
  readonly quantity: number;
  readonly priceScale: number;
}

export type PortfolioMarketQuoteResult =
  | {
      readonly kind: "success";
      readonly quote: QuoteObservation;
      readonly quoteAsOf?: string;
    }
  | {
      readonly kind: "failure";
      readonly code: string;
      readonly retryable: boolean;
      readonly provider?: string;
    };

export interface PortfolioMarketQuotePort {
  getQuote(target: PortfolioMarketTarget): Promise<PortfolioMarketQuoteResult>;
}

export type PortfolioProviderResultKind =
  | "SUCCESS"
  | "NO_DATA"
  | "RETRYABLE_FAILURE"
  | "CONTRACT_FAILURE"
  | "INVALID_DATA";

export interface PortfolioProviderAttemptObservation {
  readonly resultKind: PortfolioProviderResultKind;
  readonly errorCode?: string;
  readonly attempt: number;
  readonly latencyMs: number;
}

export interface PortfolioProviderRunObservation {
  readonly provider: string;
  readonly operation: string;
  /** Raw command/asset identifiers are only used to derive a one-way receipt hash. */
  readonly executionKey: string;
  readonly expectedData: boolean;
  readonly observedAt: string;
  readonly attempts: readonly PortfolioProviderAttemptObservation[];
  readonly finalResult:
    | {
        readonly kind: "SUCCESS";
        readonly quote: {
          readonly priceInWon: number;
          readonly observedAt: string;
        };
      }
    | {
        readonly kind: Exclude<PortfolioProviderResultKind, "SUCCESS">;
        readonly code: string;
      };
}

export interface PortfolioProviderHealthPort {
  recordRun(observation: PortfolioProviderRunObservation): Promise<void>;
}
