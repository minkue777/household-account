import type {
  MerchantRuleClaimView,
  MerchantRulePersistenceCommand,
  MerchantRulePersistenceFixture,
  MerchantRulePersistenceInputPort,
  MerchantRulePersistenceState,
  MerchantRulePersistenceWriteResult,
  PersistedMerchantRuleView,
} from "./ports/in/merchantRulePersistenceInputPort";
import { normalizedMerchantKeywordTokens } from "../domain/value-objects/merchantKeyword";

const normalizedKeywords = (keyword: string): string[] => [
  ...new Set(
    normalizedMerchantKeywordTokens(keyword).filter((value) => value.length > 0),
  ),
];

const cloneRule = (rule: PersistedMerchantRuleView): PersistedMerchantRuleView => ({
  ...rule,
  normalizedKeywords: [...rule.normalizedKeywords],
  mapping: { ...rule.mapping },
});

const claimsFor = (rule: PersistedMerchantRuleView): MerchantRuleClaimView[] =>
  rule.matchType === "exact"
    ? rule.normalizedKeywords.map((value) => ({
        kind: "exactKeyword" as const,
        matchType: "exact" as const,
        value,
        ruleId: rule.ruleId,
      }))
    : [
        {
          kind: "nonExactPriority" as const,
          matchType: rule.matchType,
          value: String(rule.priority),
          ruleId: rule.ruleId,
        },
      ];

const toRule = (
  command: MerchantRulePersistenceCommand,
  version: number,
): PersistedMerchantRuleView => ({
  ruleId: command.ruleId,
  keyword: command.keyword,
  normalizedKeywords: normalizedKeywords(command.keyword),
  matchType: command.matchType,
  ...(command.priority === undefined ? {} : { priority: command.priority }),
  active: command.active,
  mapping: { ...command.mapping },
  version,
});

const conflictsWith = (
  desired: readonly MerchantRuleClaimView[],
  existing: readonly MerchantRuleClaimView[],
): "exact" | "priority" | undefined => {
  for (const claim of desired) {
    if (
      existing.some(
        (candidate) =>
          candidate.kind === claim.kind &&
          candidate.matchType === claim.matchType &&
          candidate.value === claim.value,
      )
    ) {
      return claim.kind === "exactKeyword" ? "exact" : "priority";
    }
  }
  return undefined;
};

export function createMerchantRulePersistenceApplication(options?: {
  readonly rules?: readonly PersistedMerchantRuleView[];
}): MerchantRulePersistenceInputPort {
  let rules = (options?.rules ?? []).map(cloneRule);
  let claims = rules.flatMap(claimsFor);
  const commandResults = new Map<string, MerchantRulePersistenceWriteResult>();

  const rejectConflict = (
    conflict: "exact" | "priority",
  ): MerchantRulePersistenceWriteResult =>
    conflict === "exact"
      ? { kind: "Duplicate", code: "EXACT_KEYWORD_CONFLICT" }
      : {
          kind: "PriorityConflict",
          code: "MERCHANT_RULE_PRIORITY_CONFLICT",
        };

  return {
    read(document: MerchantRulePersistenceFixture) {
      if ("normalizedKeywords" in document) return cloneRule(document);

      return {
        ruleId: document.ruleId,
        keyword: document.keyword,
        normalizedKeywords: normalizedKeywords(document.keyword),
        matchType: document.exactMatch ? "exact" : "contains",
        active: document.active ?? true,
        mapping:
          document.category === undefined
            ? {}
            : { categoryId: document.category },
        version: 1,
      };
    },

    async createConcurrently(commands) {
      return commands.map((command) => {
        const replay = commandResults.get(command.commandId);
        if (replay !== undefined) return replay;

        const rule = toRule(command, 1);
        const desiredClaims = claimsFor(rule);
        const conflict = conflictsWith(desiredClaims, claims);
        if (conflict !== undefined) {
          const result = rejectConflict(conflict);
          commandResults.set(command.commandId, result);
          return result;
        }

        rules = [...rules, rule];
        claims = [...claims, ...desiredClaims];
        const result: MerchantRulePersistenceWriteResult = {
          kind: "Created",
          rule: cloneRule(rule),
        };
        commandResults.set(command.commandId, result);
        return result;
      });
    },

    async updateConcurrently(commands) {
      return commands.map((command) => {
        const replay = commandResults.get(command.commandId);
        if (replay !== undefined) return replay;

        const current = rules.find(({ ruleId }) => ruleId === command.ruleId);
        const updated = toRule(command, (current?.version ?? 0) + 1);
        const otherClaims = claims.filter(
          ({ ruleId }) => ruleId !== command.ruleId,
        );
        const desiredClaims = claimsFor(updated);
        const conflict = conflictsWith(desiredClaims, otherClaims);
        if (conflict !== undefined) {
          const result = rejectConflict(conflict);
          commandResults.set(command.commandId, result);
          return result;
        }

        rules = rules.map((rule) =>
          rule.ruleId === command.ruleId ? updated : rule,
        );
        claims = [...otherClaims, ...desiredClaims];
        const result: MerchantRulePersistenceWriteResult = {
          kind: "Updated",
          rule: cloneRule(updated),
        };
        commandResults.set(command.commandId, result);
        return result;
      });
    },

    state(): MerchantRulePersistenceState {
      return {
        rules: rules.map(cloneRule),
        claims: claims.map((claim) => ({ ...claim })),
      };
    },
  };
}
