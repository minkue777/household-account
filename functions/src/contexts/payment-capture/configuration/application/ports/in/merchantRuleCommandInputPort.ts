import type {
  MerchantMatchType,
  MerchantRuleActor,
  MerchantRuleCommandState,
  MerchantRuleMapping,
  MerchantRuleRecord,
} from "../../../domain/model/merchantRuleSet";

export type {
  MerchantMatchType,
  MerchantRuleActor,
  MerchantRuleCommandState,
  MerchantRuleMapping,
  MerchantRuleRecord,
} from "../../../domain/model/merchantRuleSet";

export type MerchantRuleCommandResult =
  | {
      readonly kind: "Created" | "Updated";
      readonly rule: MerchantRuleRecord;
    }
  | { readonly kind: "Deleted"; readonly ruleId: string }
  | {
      readonly kind: "Reordered";
      readonly matchType: Exclude<MerchantMatchType, "exact">;
      readonly orderedRuleIds: readonly string[];
      readonly collectionVersion: number;
    }
  | { readonly kind: "NotFound" }
  | { readonly kind: "Forbidden"; readonly code: "HOUSEHOLD_FORBIDDEN" }
  | {
      readonly kind: "Conflict";
      readonly code:
        | "VERSION_MISMATCH"
        | "EXACT_KEYWORD_CONFLICT"
        | "MERCHANT_RULE_PRIORITY_CONFLICT";
    }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "EMPTY_KEYWORD"
        | "EMPTY_OR_TOKEN"
        | "REGEX_NOT_SUPPORTED"
        | "EXACT_PRIORITY_NOT_ALLOWED"
        | "NON_EXACT_PRIORITY_REQUIRED"
        | "INCOMPLETE_RULE_SET"
        | "DUPLICATE_RULE_ID"
        | "FOREIGN_RULE_ID"
        | "MATCH_TYPE_MISMATCH";
    }
  | { readonly kind: "RetryableFailure"; readonly code: "ATOMIC_COMMIT_FAILED" };

export interface CreateMerchantRuleCommand {
  readonly actor: MerchantRuleActor;
  readonly ruleId: string;
  readonly keyword: string;
  readonly matchType: MerchantMatchType | "regex";
  readonly priority?: number;
  readonly mapping: MerchantRuleMapping;
  readonly active: boolean;
}

export interface UpdateMerchantRuleCommand {
  readonly actor: MerchantRuleActor;
  readonly ruleId: string;
  readonly expectedVersion: number;
  readonly keyword: string;
  readonly matchType: MerchantMatchType;
  readonly priority?: number;
  readonly mapping: MerchantRuleMapping;
  readonly active: boolean;
}

export interface DeleteMerchantRuleCommand {
  readonly actor: MerchantRuleActor;
  readonly ruleId: string;
  readonly expectedVersion: number;
}

export interface ReorderMerchantRulesCommand {
  readonly actor: MerchantRuleActor;
  readonly matchType: Exclude<MerchantMatchType, "exact">;
  readonly orderedRuleIds: readonly string[];
  readonly expectedCollectionVersion: number;
}

export interface MerchantRuleCommandInputPort {
  create(input: CreateMerchantRuleCommand): MerchantRuleCommandResult;
  update(input: UpdateMerchantRuleCommand): MerchantRuleCommandResult;
  delete(input: DeleteMerchantRuleCommand): MerchantRuleCommandResult;
  reorder(input: ReorderMerchantRulesCommand): MerchantRuleCommandResult;
  state(): MerchantRuleCommandState;
}
