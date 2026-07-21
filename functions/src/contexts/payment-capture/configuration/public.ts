import {
  listActiveOwnCards,
  resolveOwnCard,
} from "./domain/policies/ownCardResolution";
import {
  selectMerchantRule,
  type MerchantRuleCandidate,
  type MerchantRuleSelectionResult,
} from "./domain/policies/merchantRuleSelection";
import {
  enrichPaymentDraft,
  type EnrichedPaymentDraft,
  type PaymentDraftEnrichmentInput,
} from "./domain/policies/paymentDraftEnrichment";
import {
  enrichPaymentDraftAcrossBoundaries,
  type EnrichmentBoundaryResult,
  type PaymentDraftEnrichmentBoundaryInput,
} from "./application/enrichPaymentDraft";

export {
  normalizeCardCompanyKey,
  normalizeRegisteredLastFour,
} from "./domain/value-objects/cardIdentity";
export { normalizedMerchantKeywordTokens } from "./domain/value-objects/merchantKeyword";

export type {
  MerchantMappingDecision,
  MerchantMappingField,
  MerchantMatchType,
  MerchantRuleCandidate,
  MerchantRuleSelectionResult,
} from "./domain/policies/merchantRuleSelection";

export interface RegisteredCardResolutionInput {
  cardId: string;
  ownerMemberId: string;
  cardCompany: string;
  lastFour: string;
  orderIndex?: number;
  lifecycleState: "active" | "retired";
}

export interface ParsedCardResolutionEvidence {
  companyLabel: string;
  maskedToken?: string;
}

export type OwnCardResolution =
  | {
      kind: "eligible";
      canonicalEvidence?: {
        cardId: string;
        companyLabel: string;
        lastFour: string;
      };
    }
  | {
      kind: "unmatched";
      reason: "CARD_NOT_REGISTERED_FOR_ACTOR";
    };

export interface OwnCardResolutionPolicy {
  resolve(input: {
    actingMemberId: string;
    evidence: ParsedCardResolutionEvidence;
    cards: readonly RegisteredCardResolutionInput[];
  }): OwnCardResolution;
  listActiveCards(input: {
    actingMemberId: string;
    cards: readonly RegisteredCardResolutionInput[];
  }): readonly RegisteredCardResolutionInput[];
}

export function createOwnCardResolutionPolicy(): OwnCardResolutionPolicy {
  return {
    resolve: resolveOwnCard,
    listActiveCards: listActiveOwnCards,
  };
}

export interface MerchantRuleSelectionPolicy {
  resolve(input: {
    merchant: string;
    memo: string;
    rules: readonly MerchantRuleCandidate[];
  }): MerchantRuleSelectionResult;
}

export function createMerchantRuleSelectionPolicy(): MerchantRuleSelectionPolicy {
  return { resolve: selectMerchantRule };
}

export interface PaymentDraftEnrichmentPolicy {
  enrich(input: PaymentDraftEnrichmentInput): EnrichedPaymentDraft;
}

export type { EnrichedPaymentDraft, PaymentDraftEnrichmentInput };

export function createPaymentDraftEnrichmentPolicy(): PaymentDraftEnrichmentPolicy {
  return { enrich: enrichPaymentDraft };
}

export interface PaymentDraftEnrichmentBoundary {
  enrich(input: PaymentDraftEnrichmentBoundaryInput): EnrichmentBoundaryResult;
}

export type {
  EnrichmentBoundaryResult,
  PaymentDraftEnrichmentBoundaryInput,
};

export function createPaymentDraftEnrichmentBoundary(): PaymentDraftEnrichmentBoundary {
  return { enrich: enrichPaymentDraftAcrossBoundaries };
}

export type {
  CardBoundaryFailure,
  RegisterCardCommand,
  RegisterCardResult,
  RegisteredCardActor,
  RegisteredCardManagementInputPort,
  RegisteredCardView,
  ResolveRegisteredCardResult,
  RetireCardResult,
  RetireRegisteredCardCommand,
  UpdateCardResult,
  UpdateRegisteredCardCommand,
} from "./application/ports/in/registeredCardManagementInputPort";

export type {
  PaymentCardResolutionInputPort,
  PaymentCardResolutionResult,
  ResolvePaymentCardInput,
} from "./application/ports/in/paymentCardResolutionInputPort";

export type {
  CreateMerchantRuleCommand,
  DeleteMerchantRuleCommand,
  MerchantRuleActor,
  MerchantRuleCommandInputPort,
  MerchantRuleCommandResult,
  MerchantRuleCommandState,
  MerchantRuleMapping,
  MerchantRuleRecord,
  ReorderMerchantRulesCommand,
  UpdateMerchantRuleCommand,
} from "./application/ports/in/merchantRuleCommandInputPort";

export type {
  MerchantRuleCategoryRemapInputPort,
  MerchantRuleCategoryRemapState,
  MerchantRuleRemapPageResult,
  RemappableMerchantRule,
} from "./application/ports/in/merchantRuleCategoryRemapInputPort";

export type {
  MerchantRuleClaimView,
  MerchantRulePersistenceCommand,
  MerchantRulePersistenceFixture,
  MerchantRulePersistenceInputPort,
  MerchantRulePersistenceState,
  MerchantRulePersistenceWriteResult,
  PersistedMerchantMatchType,
  PersistedMerchantRuleView,
} from "./application/ports/in/merchantRulePersistenceInputPort";

export type {
  EditableRememberTransaction,
  RememberedExactRule,
  RememberExistingTransactionInputPort,
  RememberExistingTransactionResult,
  RememberExistingTransactionState,
} from "./application/ports/in/rememberExistingTransactionInputPort";

export type {
  RememberMerchantRuleInput,
  RememberMerchantRuleInputPort,
  RememberMerchantRuleResult,
  RememberMerchantRuleSnapshot,
} from "./application/ports/in/rememberMerchantRuleInputPort";

export type {
  HistoricalCardEvidence,
  RegisteredCardCommandActor,
  RegisteredCardCommandBoundaryInputPort,
  RegisteredCardCommandRecord,
  RegisteredCardCommandResult,
  RegisteredCardCommandState,
} from "./application/ports/in/registeredCardCommandBoundaryInputPort";

export { createMerchantRuleCategoryRemapApplication } from "./application/merchantRuleCategoryRemapApplication";
export { createMerchantRulePersistenceApplication } from "./application/merchantRulePersistenceApplication";
export { createRememberExistingTransactionApplication } from "./application/rememberExistingTransactionApplication";
export { createRememberMerchantRuleApplication } from "./application/rememberMerchantRuleApplication";
export { createRegisteredCardCommandBoundaryApplication } from "./application/registeredCardCommandBoundaryApplication";
