import type {
  CreateMerchantRuleCommand,
  DeleteMerchantRuleCommand,
  MerchantRuleCommandInputPort,
  MerchantRuleCommandResult,
  ReorderMerchantRulesCommand,
  UpdateMerchantRuleCommand,
} from "./ports/in/merchantRuleCommandInputPort";
import type { MerchantRuleCommandStorePort } from "./ports/out/merchantRuleCommandStorePort";
import type {
  MerchantMatchType,
  MerchantRuleActor,
  MerchantRuleCommandState,
  MerchantRuleMapping,
  MerchantRuleRecord,
} from "../domain/model/merchantRuleSet";
import {
  buildMerchantRuleCommandState,
  cloneMerchantRuleCommandState,
} from "../domain/policies/merchantRuleClaims";
import { normalizedMerchantKeywordTokens } from "../domain/value-objects/merchantKeyword";

type NonExactMatchType = Exclude<MerchantMatchType, "exact">;

type ValidatedRuleInput = {
  readonly keyword: string;
  readonly normalizedKeywords: readonly string[];
  readonly matchType: MerchantMatchType;
  readonly priority?: number;
  readonly mapping: MerchantRuleMapping;
  readonly active: boolean;
};

type ValidationResult =
  | { readonly kind: "Valid"; readonly value: ValidatedRuleInput }
  | {
      readonly kind: "Rejected";
      readonly code:
        | "EMPTY_KEYWORD"
        | "EMPTY_OR_TOKEN"
        | "REGEX_NOT_SUPPORTED"
        | "EXACT_PRIORITY_NOT_ALLOWED"
        | "NON_EXACT_PRIORITY_REQUIRED";
    };

function validateRuleInput(input: {
  readonly keyword: string;
  readonly matchType: MerchantMatchType | "regex";
  readonly priority?: number;
  readonly mapping: MerchantRuleMapping;
  readonly active: boolean;
}): ValidationResult {
  if (input.matchType === "regex") {
    return { kind: "Rejected", code: "REGEX_NOT_SUPPORTED" };
  }
  if (input.keyword.trim() === "") {
    return { kind: "Rejected", code: "EMPTY_KEYWORD" };
  }

  const tokens = normalizedMerchantKeywordTokens(input.keyword);
  if (tokens.some((token) => token === "")) {
    return { kind: "Rejected", code: "EMPTY_OR_TOKEN" };
  }
  if (input.matchType === "exact" && input.priority !== undefined) {
    return { kind: "Rejected", code: "EXACT_PRIORITY_NOT_ALLOWED" };
  }
  if (
    input.matchType !== "exact" &&
    (!Number.isSafeInteger(input.priority) || (input.priority as number) <= 0)
  ) {
    return { kind: "Rejected", code: "NON_EXACT_PRIORITY_REQUIRED" };
  }

  return {
    kind: "Valid",
    value: {
      keyword: input.keyword.trim(),
      normalizedKeywords: [...new Set(tokens)],
      matchType: input.matchType,
      ...(input.matchType === "exact" ? {} : { priority: input.priority }),
      mapping: { ...input.mapping },
      active: input.active,
    },
  };
}

function isAuthorized(
  actor: MerchantRuleActor,
  householdId: string,
): boolean {
  return (
    actor.householdId === householdId &&
    actor.memberId.trim() !== "" &&
    actor.capability === "paymentConfiguration:manage"
  );
}

function collectionKey(
  householdId: string,
  matchType: NonExactMatchType,
): string {
  return `${householdId}:${matchType}`;
}

function bumpedCollectionVersions(
  current: Readonly<Record<string, number>>,
  householdId: string,
  matchTypes: readonly MerchantMatchType[],
): Readonly<Record<string, number>> {
  const next = { ...current };
  for (const matchType of new Set(matchTypes)) {
    if (matchType === "exact") continue;
    const key = collectionKey(householdId, matchType);
    next[key] = (next[key] ?? 0) + 1;
  }
  return next;
}

function conflictFor(
  current: MerchantRuleCommandState,
  householdId: string,
  proposal: ValidatedRuleInput,
  ignoredRuleId?: string,
): MerchantRuleCommandResult | undefined {
  const otherRules = current.rules.filter(
    (rule) =>
      rule.householdId === householdId && rule.ruleId !== ignoredRuleId,
  );

  if (proposal.matchType === "exact") {
    const occupied = new Set(
      otherRules
        .filter((rule) => rule.matchType === "exact")
        .flatMap((rule) => rule.normalizedKeywords),
    );
    return proposal.normalizedKeywords.some((token) => occupied.has(token))
      ? { kind: "Conflict", code: "EXACT_KEYWORD_CONFLICT" }
      : undefined;
  }

  return otherRules.some(
    (rule) =>
      rule.matchType === proposal.matchType &&
      rule.priority === proposal.priority,
  )
    ? { kind: "Conflict", code: "MERCHANT_RULE_PRIORITY_CONFLICT" }
    : undefined;
}

function unchanged(
  state: MerchantRuleCommandState,
  value: MerchantRuleCommandResult,
) {
  return { state, value, writes: false } as const;
}

function changed(
  state: MerchantRuleCommandState,
  value: MerchantRuleCommandResult,
) {
  return { state, value, writes: true } as const;
}

function applyTransaction(
  store: MerchantRuleCommandStorePort,
  decide: (
    current: MerchantRuleCommandState,
  ) => ReturnType<typeof unchanged> | ReturnType<typeof changed>,
): MerchantRuleCommandResult {
  const outcome = store.transact(decide);
  return outcome.kind === "CommitFailed"
    ? { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" }
    : outcome.value;
}

function toRule(input: {
  readonly householdId: string;
  readonly ruleId: string;
  readonly validated: ValidatedRuleInput;
  readonly version: number;
}): MerchantRuleRecord {
  return {
    ruleId: input.ruleId,
    householdId: input.householdId,
    ...input.validated,
    version: input.version,
  };
}

export function createMerchantRuleCommandApplication(dependencies: {
  readonly householdId: string;
  readonly store: MerchantRuleCommandStorePort;
}): MerchantRuleCommandInputPort {
  const forbidden = (actor: MerchantRuleActor): MerchantRuleCommandResult | undefined =>
    isAuthorized(actor, dependencies.householdId)
      ? undefined
      : { kind: "Forbidden", code: "HOUSEHOLD_FORBIDDEN" };

  return {
    create(input: CreateMerchantRuleCommand) {
      const denied = forbidden(input.actor);
      if (denied !== undefined) return denied;
      const validation = validateRuleInput(input);
      if (validation.kind === "Rejected") return validation;

      return applyTransaction(dependencies.store, (current) => {
        if (current.rules.some(({ ruleId }) => ruleId === input.ruleId)) {
          return unchanged(current, {
            kind: "Rejected",
            code: "DUPLICATE_RULE_ID",
          });
        }
        const conflict = conflictFor(
          current,
          dependencies.householdId,
          validation.value,
        );
        if (conflict !== undefined) return unchanged(current, conflict);

        const createdRule = toRule({
          householdId: dependencies.householdId,
          ruleId: input.ruleId,
          validated: validation.value,
          version: 1,
        });
        const next = buildMerchantRuleCommandState({
          rules: [...current.rules, createdRule],
          collectionVersions: bumpedCollectionVersions(
            current.collectionVersions,
            dependencies.householdId,
            [createdRule.matchType],
          ),
        });
        return changed(next, { kind: "Created", rule: createdRule });
      });
    },

    update(input: UpdateMerchantRuleCommand) {
      const denied = forbidden(input.actor);
      if (denied !== undefined) return denied;

      return applyTransaction(dependencies.store, (current) => {
        const target = current.rules.find(({ ruleId }) => ruleId === input.ruleId);
        if (target === undefined) return unchanged(current, { kind: "NotFound" });
        if (target.householdId !== input.actor.householdId) {
          return unchanged(current, {
            kind: "Forbidden",
            code: "HOUSEHOLD_FORBIDDEN",
          });
        }
        if (target.version !== input.expectedVersion) {
          return unchanged(current, {
            kind: "Conflict",
            code: "VERSION_MISMATCH",
          });
        }

        const validation = validateRuleInput(input);
        if (validation.kind === "Rejected") return unchanged(current, validation);
        const conflict = conflictFor(
          current,
          dependencies.householdId,
          validation.value,
          target.ruleId,
        );
        if (conflict !== undefined) return unchanged(current, conflict);

        const updatedRule = toRule({
          householdId: target.householdId,
          ruleId: target.ruleId,
          validated: validation.value,
          version: target.version + 1,
        });
        const next = buildMerchantRuleCommandState({
          rules: current.rules.map((rule) =>
            rule.ruleId === target.ruleId ? updatedRule : rule,
          ),
          collectionVersions: bumpedCollectionVersions(
            current.collectionVersions,
            dependencies.householdId,
            [target.matchType, updatedRule.matchType],
          ),
        });
        return changed(next, { kind: "Updated", rule: updatedRule });
      });
    },

    delete(input: DeleteMerchantRuleCommand) {
      const denied = forbidden(input.actor);
      if (denied !== undefined) return denied;

      return applyTransaction(dependencies.store, (current) => {
        const target = current.rules.find(({ ruleId }) => ruleId === input.ruleId);
        if (target === undefined) return unchanged(current, { kind: "NotFound" });
        if (target.householdId !== input.actor.householdId) {
          return unchanged(current, {
            kind: "Forbidden",
            code: "HOUSEHOLD_FORBIDDEN",
          });
        }
        if (target.version !== input.expectedVersion) {
          return unchanged(current, {
            kind: "Conflict",
            code: "VERSION_MISMATCH",
          });
        }

        const next = buildMerchantRuleCommandState({
          rules: current.rules.filter(({ ruleId }) => ruleId !== target.ruleId),
          collectionVersions: bumpedCollectionVersions(
            current.collectionVersions,
            dependencies.householdId,
            [target.matchType],
          ),
        });
        return changed(next, { kind: "Deleted", ruleId: target.ruleId });
      });
    },

    reorder(input: ReorderMerchantRulesCommand) {
      const denied = forbidden(input.actor);
      if (denied !== undefined) return denied;

      return applyTransaction(dependencies.store, (current) => {
        const key = collectionKey(dependencies.householdId, input.matchType);
        const currentCollectionVersion = current.collectionVersions[key] ?? 0;
        if (currentCollectionVersion !== input.expectedCollectionVersion) {
          return unchanged(current, {
            kind: "Conflict",
            code: "VERSION_MISMATCH",
          });
        }
        if (new Set(input.orderedRuleIds).size !== input.orderedRuleIds.length) {
          return unchanged(current, {
            kind: "Rejected",
            code: "DUPLICATE_RULE_ID",
          });
        }

        const requestedRules = input.orderedRuleIds.map((ruleId) =>
          current.rules.find((rule) => rule.ruleId === ruleId),
        );
        if (
          requestedRules.some(
            (rule) =>
              rule !== undefined &&
              rule.householdId !== dependencies.householdId,
          )
        ) {
          return unchanged(current, {
            kind: "Rejected",
            code: "FOREIGN_RULE_ID",
          });
        }
        if (
          requestedRules.some(
            (rule) =>
              rule !== undefined && rule.matchType !== input.matchType,
          )
        ) {
          return unchanged(current, {
            kind: "Rejected",
            code: "MATCH_TYPE_MISMATCH",
          });
        }

        const completeRuleIds = current.rules
          .filter(
            (rule) =>
              rule.householdId === dependencies.householdId &&
              rule.matchType === input.matchType,
          )
          .map(({ ruleId }) => ruleId);
        if (
          requestedRules.some((rule) => rule === undefined) ||
          completeRuleIds.length !== input.orderedRuleIds.length ||
          completeRuleIds.some((ruleId) => !input.orderedRuleIds.includes(ruleId))
        ) {
          return unchanged(current, {
            kind: "Rejected",
            code: "INCOMPLETE_RULE_SET",
          });
        }

        const priorityByRuleId = new Map(
          input.orderedRuleIds.map((ruleId, index) => [
            ruleId,
            (input.orderedRuleIds.length - index) * 10,
          ]),
        );
        const reorderedRules = current.rules.map((rule) => {
          const priority = priorityByRuleId.get(rule.ruleId);
          return priority === undefined
            ? rule
            : { ...rule, priority, version: rule.version + 1 };
        });
        const nextCollectionVersion = currentCollectionVersion + 1;
        const next = buildMerchantRuleCommandState({
          rules: reorderedRules,
          collectionVersions: {
            ...current.collectionVersions,
            [key]: nextCollectionVersion,
          },
        });
        return changed(next, {
          kind: "Reordered",
          matchType: input.matchType,
          orderedRuleIds: [...input.orderedRuleIds],
          collectionVersion: nextCollectionVersion,
        });
      });
    },

    state: () => cloneMerchantRuleCommandState(dependencies.store.read()),
  };
}
