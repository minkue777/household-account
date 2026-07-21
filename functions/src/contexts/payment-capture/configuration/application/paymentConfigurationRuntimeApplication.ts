import { createHash } from "node:crypto";

import { createMerchantRuleCommandApplication } from "./merchantRuleCommandApplication";
import type {
  MerchantRuleCommandResult,
  MerchantRuleCommandState,
  MerchantRuleMapping,
} from "./ports/in/merchantRuleCommandInputPort";
import { createRegisteredCardCommandBoundaryApplication } from "./registeredCardCommandBoundaryApplication";
import type {
  RegisteredCardCommandResult,
  RegisteredCardCommandState,
} from "./ports/in/registeredCardCommandBoundaryInputPort";
import type {
  AtomicPaymentConfigurationMutation,
  PaymentConfigurationAtomicStorePort,
  PaymentConfigurationCommandMetadata,
} from "./ports/out/paymentConfigurationAtomicStorePort";
import { cloneMerchantRuleCommandState } from "../domain/policies/merchantRuleClaims";
import { normalizeCardCompanyKey } from "../domain/value-objects/cardIdentity";

export interface PaymentConfigurationRuntimeActor {
  readonly householdId: string;
  readonly memberId: string;
}

export interface PaymentConfigurationRuntimeCommand {
  readonly actor: PaymentConfigurationRuntimeActor;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly commandName: string;
  readonly payloadFingerprint: string;
  readonly occurredAt: string;
}

export type PaymentConfigurationRuntimeResult =
  | { readonly kind: "success"; readonly value: Readonly<Record<string, unknown>> }
  | { readonly kind: "rejected"; readonly code: string; readonly retryable?: true };

type MatchType = "exact" | "startsWith" | "endsWith" | "contains";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function matchType(value: unknown): MatchType | undefined {
  return value === "exact" ||
    value === "startsWith" ||
    value === "endsWith" ||
    value === "contains"
    ? value
    : undefined;
}

function positivePriority(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mapping(value: unknown): MerchantRuleMapping | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const allowed = new Set(["merchant", "category", "categoryId", "memo"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return undefined;

  const merchant = raw.merchant;
  const category = raw.categoryId ?? raw.category;
  const memo = raw.memo;
  if (
    (merchant !== undefined && typeof merchant !== "string") ||
    (category !== undefined && typeof category !== "string") ||
    (memo !== undefined && typeof memo !== "string")
  ) {
    return undefined;
  }
  return {
    ...(typeof merchant === "string" && merchant.trim() !== ""
      ? { merchant: merchant.trim() }
      : {}),
    ...(typeof category === "string" && category.trim() !== ""
      ? { categoryId: category.trim() }
      : {}),
    ...(typeof memo === "string" && memo.trim() !== ""
      ? { memo: memo.trim() }
      : {}),
  };
}

function nextPriority(
  state: MerchantRuleCommandState,
  householdId: string,
  type: Exclude<MatchType, "exact">,
  ignoredRuleId?: string,
): number {
  const maximum = state.rules
    .filter(
      (rule) =>
        rule.householdId === householdId &&
        rule.ruleId !== ignoredRuleId &&
        rule.matchType === type &&
        typeof rule.priority === "number" &&
        Number.isSafeInteger(rule.priority),
    )
    .reduce((current, rule) => Math.max(current, rule.priority ?? 0), 0);
  return Math.max(10, Math.floor(maximum / 10) * 10 + 10);
}

function deterministicId(prefix: string, householdId: string, commandId: string): string {
  return `${prefix}-${createHash("sha256")
    .update(`${householdId}\u0000${commandId}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function metadata(
  input: PaymentConfigurationRuntimeCommand,
): PaymentConfigurationCommandMetadata {
  return {
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    commandName: input.commandName,
    payloadFingerprint: input.payloadFingerprint,
    householdId: input.actor.householdId,
    actorMemberId: input.actor.memberId,
    occurredAt: input.occurredAt,
  };
}

function merchantMutation(
  current: MerchantRuleCommandState,
  householdId: string,
  execute: (
    application: ReturnType<typeof createMerchantRuleCommandApplication>,
    state: MerchantRuleCommandState,
  ) => MerchantRuleCommandResult,
): AtomicPaymentConfigurationMutation<
  MerchantRuleCommandState,
  MerchantRuleCommandResult
> {
  let next = cloneMerchantRuleCommandState(current);
  let writes = false;
  const application = createMerchantRuleCommandApplication({
    householdId,
    store: {
      read: () => cloneMerchantRuleCommandState(next),
      transact(decide) {
        const outcome = decide(cloneMerchantRuleCommandState(next));
        next = cloneMerchantRuleCommandState(outcome.state);
        writes = outcome.writes;
        return { kind: "Committed", value: outcome.value };
      },
    },
  });
  const value = execute(application, current);
  return { state: next, value, writes };
}

function cardMutation(
  current: RegisteredCardCommandState,
  householdId: string,
  execute: (
    application: ReturnType<typeof createRegisteredCardCommandBoundaryApplication>,
  ) => RegisteredCardCommandResult,
): AtomicPaymentConfigurationMutation<
  RegisteredCardCommandState,
  RegisteredCardCommandResult
> {
  const application = createRegisteredCardCommandBoundaryApplication({
    boundaryHouseholdId: householdId,
    cards: current.cards,
    historicalEvidence: current.historicalEvidence,
    collectionVersions: current.collectionVersions,
  });
  const value = execute(application);
  const state = application.state();
  return {
    state,
    value,
    writes: JSON.stringify(state) !== JSON.stringify(current),
  };
}

function result(
  atomic:
    | { readonly kind: "committed" | "replayed"; readonly value: MerchantRuleCommandResult | RegisteredCardCommandResult }
    | { readonly kind: "payload-mismatch" }
    | { readonly kind: "commit-failed" },
  success: (value: MerchantRuleCommandResult | RegisteredCardCommandResult) => Readonly<Record<string, unknown>> | undefined,
): PaymentConfigurationRuntimeResult {
  if (atomic.kind === "payload-mismatch") {
    return { kind: "rejected", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" };
  }
  if (atomic.kind === "commit-failed") {
    return { kind: "rejected", code: "ATOMIC_COMMIT_FAILED", retryable: true };
  }
  const successful = success(atomic.value);
  if (successful !== undefined) return { kind: "success", value: successful };
  if (atomic.value.kind === "RetryableFailure") {
    return { kind: "rejected", code: atomic.value.code, retryable: true };
  }
  if (atomic.value.kind === "NotFound") {
    return { kind: "rejected", code: "NOT_FOUND" };
  }
  return {
    kind: "rejected",
    code: "code" in atomic.value ? atomic.value.code : "COMMAND_REJECTED",
  };
}

export function createPaymentConfigurationRuntimeApplication(
  store: PaymentConfigurationAtomicStorePort,
) {
  const actor = (input: PaymentConfigurationRuntimeCommand) => ({
    householdId: input.actor.householdId,
    memberId: input.actor.memberId,
    capability: "paymentConfiguration:manage" as const,
  });
  const cardActor = (input: PaymentConfigurationRuntimeCommand) => ({
    principalUid: "verified-by-household-command-router",
    householdId: input.actor.householdId,
    memberId: input.actor.memberId,
    capability: "paymentConfiguration:manage" as const,
  });

  return {
    async createMerchantRule(
      input: PaymentConfigurationRuntimeCommand & { readonly rule: unknown },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const raw = record(input.rule);
      if (raw === undefined) return { kind: "rejected", code: "INVALID_RULE" };
      const allowed = new Set([
        "merchantKeyword",
        "matchType",
        "mapping",
        "priority",
        "isActive",
      ]);
      if (Object.keys(raw).some((key) => !allowed.has(key))) {
        return { kind: "rejected", code: "INVALID_RULE" };
      }
      const keyword = nonEmptyString(raw.merchantKeyword);
      const type = matchType(raw.matchType);
      const ruleMapping = mapping(raw.mapping);
      if (keyword === undefined) return { kind: "rejected", code: "EMPTY_KEYWORD" };
      if (type === undefined) return { kind: "rejected", code: "INVALID_MATCH_TYPE" };
      if (ruleMapping === undefined) return { kind: "rejected", code: "INVALID_MAPPING" };
      if (raw.isActive !== undefined && optionalBoolean(raw.isActive) === undefined) {
        return { kind: "rejected", code: "INVALID_ACTIVE_STATE" };
      }
      if (raw.priority !== undefined && positivePriority(raw.priority) === undefined) {
        return { kind: "rejected", code: "INVALID_PRIORITY" };
      }
      if (type === "exact" && raw.priority !== undefined) {
        return { kind: "rejected", code: "EXACT_PRIORITY_NOT_ALLOWED" };
      }

      const atomic = await store.transactMerchantRules(
        metadata(input),
        (current) =>
          merchantMutation(current, input.actor.householdId, (application) =>
            application.create({
              actor: actor(input),
              ruleId: deterministicId("merchant-rule", input.actor.householdId, input.commandId),
              keyword,
              matchType: type,
              ...(type === "exact"
                ? {}
                : {
                    priority:
                      positivePriority(raw.priority) ??
                      nextPriority(current, input.actor.householdId, type),
                  }),
              mapping: ruleMapping,
              active: optionalBoolean(raw.isActive) ?? true,
            }),
          ),
      );
      return result(atomic, (value) =>
        value.kind === "Created" && "rule" in value
          ? { ruleId: value.rule.ruleId }
          : undefined,
      );
    },

    async updateMerchantRule(
      input: PaymentConfigurationRuntimeCommand & {
        readonly ruleId: string;
        readonly changes: unknown;
      },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const changes = record(input.changes);
      if (changes === undefined) return { kind: "rejected", code: "INVALID_CHANGES" };
      const allowed = new Set([
        "merchantKeyword",
        "matchType",
        "mapping",
        "priority",
        "isActive",
      ]);
      if (Object.keys(changes).some((key) => !allowed.has(key))) {
        return { kind: "rejected", code: "INVALID_CHANGES" };
      }

      const atomic = await store.transactMerchantRules(
        metadata(input),
        (current) =>
          merchantMutation(current, input.actor.householdId, (application) => {
            const target = current.rules.find(({ ruleId }) => ruleId === input.ruleId);
            if (target === undefined) return { kind: "NotFound" };
            const requestedType =
              changes.matchType === undefined
                ? target.matchType
                : matchType(changes.matchType);
            const requestedKeyword =
              changes.merchantKeyword === undefined
                ? target.keyword
                : nonEmptyString(changes.merchantKeyword);
            const requestedMapping =
              changes.mapping === undefined
                ? target.mapping
                : mapping(changes.mapping);
            const requestedActive =
              changes.isActive === undefined
                ? target.active
                : optionalBoolean(changes.isActive);
            if (requestedType === undefined) {
              return { kind: "Rejected", code: "REGEX_NOT_SUPPORTED" };
            }
            if (requestedKeyword === undefined) {
              return { kind: "Rejected", code: "EMPTY_KEYWORD" };
            }
            if (requestedMapping === undefined || requestedActive === undefined) {
              return { kind: "Rejected", code: "EMPTY_KEYWORD" };
            }
            if (
              changes.priority !== undefined &&
              positivePriority(changes.priority) === undefined
            ) {
              return { kind: "Rejected", code: "NON_EXACT_PRIORITY_REQUIRED" };
            }
            if (requestedType === "exact" && changes.priority !== undefined) {
              return { kind: "Rejected", code: "EXACT_PRIORITY_NOT_ALLOWED" };
            }
            const priority =
              requestedType === "exact"
                ? undefined
                : positivePriority(changes.priority) ??
                  (target.matchType === requestedType &&
                  typeof target.priority === "number" &&
                  target.priority > 0
                    ? target.priority
                    : nextPriority(
                        current,
                        input.actor.householdId,
                        requestedType,
                        target.ruleId,
                      ));
            return application.update({
              actor: actor(input),
              ruleId: target.ruleId,
              expectedVersion: target.version,
              keyword: requestedKeyword,
              matchType: requestedType,
              ...(priority === undefined ? {} : { priority }),
              mapping: {
                ...target.mapping,
                ...requestedMapping,
              },
              active: requestedActive,
            });
          }),
      );
      return result(atomic, (value) =>
        value.kind === "Updated" ? {} : undefined,
      );
    },

    async deleteMerchantRule(
      input: PaymentConfigurationRuntimeCommand & { readonly ruleId: string },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const atomic = await store.transactMerchantRules(
        metadata(input),
        (current) =>
          merchantMutation(current, input.actor.householdId, (application) => {
            const target = current.rules.find(({ ruleId }) => ruleId === input.ruleId);
            return target === undefined
              ? { kind: "NotFound" }
              : application.delete({
                  actor: actor(input),
                  ruleId: target.ruleId,
                  expectedVersion: target.version,
                });
          }),
      );
      return result(atomic, (value) =>
        value.kind === "Deleted" ? {} : undefined,
      );
    },

    async registerCard(
      input: PaymentConfigurationRuntimeCommand & { readonly card: unknown },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const raw = record(input.card);
      const label = nonEmptyString(raw?.cardLabel);
      if (raw === undefined || label === undefined) {
        return { kind: "rejected", code: "INVALID_CARD_COMPANY" };
      }
      if (
        Object.keys(raw).some(
          (key) => key !== "cardLabel" && key !== "cardLastFour",
        )
      ) {
        return { kind: "rejected", code: "INVALID_CARD" };
      }
      if (raw.cardLastFour !== undefined && typeof raw.cardLastFour !== "string") {
        return { kind: "rejected", code: "INVALID_LAST_FOUR" };
      }
      const atomic = await store.transactRegisteredCards(
        metadata(input),
        (current) =>
          cardMutation(current, input.actor.householdId, (application) =>
            application.register({
              actor: cardActor(input),
              ownerMemberId: input.actor.memberId,
              cardId: deterministicId("registered-card", input.actor.householdId, input.commandId),
              cardCompanyCode: label,
              ...(typeof raw.cardLastFour === "string"
                ? { rawLastFour: raw.cardLastFour }
                : {}),
            }),
          ),
      );
      return result(atomic, (value) =>
        value.kind === "Created" && "card" in value
          ? { cardId: value.card.cardId }
          : undefined,
      );
    },

    async updateCard(
      input: PaymentConfigurationRuntimeCommand & {
        readonly cardId: string;
        readonly changes: unknown;
      },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const changes = record(input.changes);
      if (changes === undefined) return { kind: "rejected", code: "INVALID_CHANGES" };
      const allowed = new Set(["cardLabel", "cardLastFour"]);
      if (Object.keys(changes).some((key) => !allowed.has(key))) {
        return { kind: "rejected", code: "CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION" };
      }
      if (
        changes.cardLabel !== undefined &&
        nonEmptyString(changes.cardLabel) === undefined
      ) {
        return { kind: "rejected", code: "INVALID_CARD_COMPANY" };
      }
      if (
        changes.cardLastFour !== undefined &&
        typeof changes.cardLastFour !== "string"
      ) {
        return { kind: "rejected", code: "INVALID_LAST_FOUR" };
      }
      const changesLastFour =
        typeof changes.cardLastFour === "string"
          ? changes.cardLastFour
          : undefined;
      const atomic = await store.transactRegisteredCards(
        metadata(input),
        (current) =>
          cardMutation(current, input.actor.householdId, (application) => {
            const target = current.cards.find(({ cardId }) => cardId === input.cardId);
            if (target === undefined) return { kind: "NotFound" };
            if (
              typeof changes.cardLabel === "string" &&
              normalizeCardCompanyKey(changes.cardLabel) !==
                normalizeCardCompanyKey(target.cardCompanyCode)
            ) {
              return {
                kind: "Forbidden",
                code: "OWNER_FORBIDDEN",
              };
            }
            if (changesLastFour === undefined) {
              return { kind: "Updated", card: target };
            }
            return application.updateLastFour({
              actor: cardActor(input),
              cardId: target.cardId,
              rawLastFour: changesLastFour,
              expectedVersion: target.version,
            });
          }),
      );
      const outcome = result(atomic, (value) =>
        value.kind === "Updated" ? {} : undefined,
      );
      return outcome.kind === "rejected" &&
        outcome.code === "OWNER_FORBIDDEN" &&
        typeof changes.cardLabel === "string"
        ? {
            kind: "rejected",
            code: "CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION",
          }
        : outcome;
    },

    async deleteCard(
      input: PaymentConfigurationRuntimeCommand & { readonly cardId: string },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const atomic = await store.transactRegisteredCards(
        metadata(input),
        (current) =>
          cardMutation(current, input.actor.householdId, (application) => {
            const target = current.cards.find(({ cardId }) => cardId === input.cardId);
            return target === undefined
              ? { kind: "NotFound" }
              : application.retire({
                  actor: cardActor(input),
                  cardId: target.cardId,
                  expectedVersion: target.version,
                });
          }),
      );
      return result(atomic, (value) =>
        value.kind === "Retired" ? {} : undefined,
      );
    },

    async reorderCards(
      input: PaymentConfigurationRuntimeCommand & {
        readonly cardIds: readonly string[];
      },
    ): Promise<PaymentConfigurationRuntimeResult> {
      const atomic = await store.transactRegisteredCards(
        metadata(input),
        (current) => {
          const key = `${input.actor.householdId}:${input.actor.memberId}`;
          return cardMutation(current, input.actor.householdId, (application) =>
            application.reorder({
              actor: cardActor(input),
              ownerMemberId: input.actor.memberId,
              orderedCardIds: input.cardIds,
              expectedCollectionVersion: current.collectionVersions[key] ?? 0,
            }),
          );
        },
      );
      return result(atomic, (value) =>
        value.kind === "Reordered" ? {} : undefined,
      );
    },
  };
}
