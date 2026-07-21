import type * as firestore from "firebase-admin/firestore";

import {
  normalizeCardCompanyKey,
  normalizeRegisteredLastFour,
  normalizedMerchantKeywordTokens,
} from "../../../../contexts/payment-capture/configuration/public";
import {
  candidateDraft,
  createdAndUpdated,
  fieldsMatch,
  legacySchemaInScope,
  migrationIssue,
  numberValue,
  objectValue,
  positiveInteger,
  rawSha256,
  resolveMember,
  text,
  type MigrationDocumentData,
  type RuntimeMigrationCandidateDraft,
  type RuntimeMigrationCollectorIssue,
  type RuntimeMigrationCollectorResult,
  type RuntimeMigrationCollectorScope,
} from "./runtimeMigrationCollectorContract";

type MerchantMatchType = "exact" | "startsWith" | "endsWith" | "contains";

export interface PaymentConfigurationRuntimeMigrationCollectorInput
  extends RuntimeMigrationCollectorScope {
  readonly memberIds: ReadonlySet<string>;
  readonly legacyCards: readonly firestore.QueryDocumentSnapshot[];
  readonly legacyMerchantRules: readonly firestore.QueryDocumentSnapshot[];
  readonly canonicalCards: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalCardClaims: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalMerchantRules: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalMerchantClaims: ReadonlyMap<string, MigrationDocumentData>;
}

interface PreparedCard {
  readonly snapshot: firestore.QueryDocumentSnapshot;
  readonly targetData: Readonly<Record<string, unknown>>;
  readonly claimId?: string;
  readonly claimData?: Readonly<Record<string, unknown>>;
}

interface PreparedMerchantRule {
  readonly snapshot: firestore.QueryDocumentSnapshot;
  readonly targetData: Readonly<Record<string, unknown>>;
  readonly claims: readonly {
    readonly claimId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }[];
}

function merchantMatchType(data: MigrationDocumentData): MerchantMatchType {
  const stored = text(data, "matchType");
  return stored === "exact" ||
    stored === "startsWith" ||
    stored === "endsWith" ||
    stored === "contains"
    ? stored
    : data.exactMatch === true
      ? "exact"
      : "contains";
}

function merchantClaims(input: {
  readonly householdId: string;
  readonly ruleId: string;
  readonly keyword: string;
  readonly matchType: MerchantMatchType;
  readonly priority?: number;
}): readonly {
  readonly claimId: string;
  readonly data: Readonly<Record<string, unknown>>;
}[] {
  const tokens = [...new Set(normalizedMerchantKeywordTokens(input.keyword))];
  if (input.matchType === "exact") {
    return tokens.map((token) => ({
      claimId: rawSha256(`exact\u0000${token}`),
      data: {
        householdId: input.householdId,
        kind: "exact",
        token,
        ruleId: input.ruleId,
        schemaVersion: 1,
      },
    }));
  }
  return input.priority === undefined
    ? []
    : [
        {
          claimId: rawSha256(
            `priority\u0000${input.matchType}\u0000${input.priority}`,
          ),
          data: {
            householdId: input.householdId,
            kind: "priority",
            matchType: input.matchType,
            priority: input.priority,
            ruleId: input.ruleId,
            schemaVersion: 1,
          },
        },
      ];
}

export function collectPaymentConfigurationRuntimeMigration(
  input: PaymentConfigurationRuntimeMigrationCollectorInput,
): RuntimeMigrationCollectorResult {
  const drafts: RuntimeMigrationCandidateDraft[] = [];
  const unresolved: RuntimeMigrationCollectorIssue[] = [];
  const preparedCards: PreparedCard[] = [];
  const cardIdentityOwners = new Map<string, Set<string>>();
  const registerCardIdentity = (identity: string, cardId: string) => {
    const owners = cardIdentityOwners.get(identity) ?? new Set<string>();
    owners.add(cardId);
    cardIdentityOwners.set(identity, owners);
  };

  for (const snapshot of input.canonicalCards.entries()) {
    const [cardId, data] = snapshot;
    const ownerMemberId = text(data, "ownerMemberId");
    const company = text(data, "cardCompanyCode", "cardCompany", "cardLabel");
    const rawLastFour = text(data, "lastFour", "cardLastFour");
    const lastFour =
      rawLastFour === "" ? undefined : normalizeRegisteredLastFour(rawLastFour);
    const isActive =
      text(data, "lifecycle", "lifecycleState") !== "retired" &&
      data.deletedAt === undefined;
    if (ownerMemberId !== "" && company !== "" && isActive) {
      registerCardIdentity(
        rawSha256(
          `${ownerMemberId}\u0000${normalizeCardCompanyKey(company)}\u0000${lastFour ?? ""}`,
        ),
        cardId,
      );
    }
  }

  for (const snapshot of input.legacyCards) {
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "registered_cards",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const ownerMemberId = resolveMember({
      raw: text(data, "ownerMemberId", "owner"),
      documentId: snapshot.id,
      explicitByDocument: input.mappings.registeredCardOwners,
      mappings: input.mappings,
      memberIds: input.memberIds,
    });
    if (ownerMemberId === undefined) {
      unresolved.push(
        migrationIssue({
          code: "REGISTERED_CARD_OWNER_MAPPING_REQUIRED",
          sourceCollection: "registered_cards",
          reference: snapshot.ref.path,
          requiredManifestField: "registeredCardOwners",
        }),
      );
      continue;
    }
    const cardCompanyCode = text(
      data,
      "cardCompanyCode",
      "cardCompany",
      "cardLabel",
    );
    if (cardCompanyCode === "") {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "registered_cards",
          reference: snapshot.ref.path,
          detailCode: "CARD_COMPANY_REQUIRED",
        }),
      );
      continue;
    }
    const rawLastFour = text(data, "lastFour", "cardLastFour");
    const lastFour =
      rawLastFour === "" ? undefined : normalizeRegisteredLastFour(rawLastFour);
    if (rawLastFour !== "" && lastFour === undefined) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "registered_cards",
          reference: snapshot.ref.path,
          detailCode: "INVALID_CARD_LAST_FOUR",
        }),
      );
      continue;
    }
    const lifecycle =
      text(data, "lifecycle", "lifecycleState") === "retired" ||
      data.deletedAt !== undefined
        ? "retired"
        : "active";
    const timestamps = createdAndUpdated(data, input.plannedAt);
    const targetData = {
      householdId: input.scope.householdId,
      cardId: snapshot.id,
      ownerMemberId,
      cardCompanyCode,
      lastFour: lastFour ?? "",
      order: positiveInteger(data, 0, "order", "orderIndex"),
      lifecycle,
      aggregateVersion: Math.max(
        1,
        positiveInteger(data, 1, "aggregateVersion", "version"),
      ),
      schemaVersion: 2,
      ...timestamps,
    };
    const claimId =
      lifecycle === "active"
        ? rawSha256(
            `${ownerMemberId}\u0000${normalizeCardCompanyKey(cardCompanyCode)}\u0000${lastFour ?? ""}`,
          )
        : undefined;
    if (claimId !== undefined) registerCardIdentity(claimId, snapshot.id);
    preparedCards.push({
      snapshot,
      targetData,
      ...(claimId === undefined
        ? {}
        : {
            claimId,
            claimData: {
              householdId: input.scope.householdId,
              ownerMemberId,
              cardCompanyCode,
              ...(lastFour === undefined ? {} : { lastFour }),
              cardId: snapshot.id,
              schemaVersion: 1,
              createdAt: timestamps.createdAt,
            },
          }),
    });
  }

  for (const prepared of preparedCards) {
    if (
      prepared.claimId !== undefined &&
      (cardIdentityOwners.get(prepared.claimId)?.size ?? 0) > 1
    ) {
      unresolved.push(
        migrationIssue({
          code: "REGISTERED_CARD_IDENTITY_CONFLICT",
          sourceCollection: "registered_cards",
          reference: prepared.snapshot.ref.path,
          detailCode: "DUPLICATE_ACTIVE_CARD_IDENTITY",
        }),
      );
      continue;
    }
    const existingCard = input.canonicalCards.get(prepared.snapshot.id);
    const cardFields = [
      "householdId",
      "cardId",
      "ownerMemberId",
      "cardCompanyCode",
      "lastFour",
      "order",
      "lifecycle",
      "aggregateVersion",
      "schemaVersion",
    ];
    if (existingCard === undefined) {
      drafts.push(
        candidateDraft(prepared.snapshot, {
          targetPath: `${input.householdPath}/registeredCards/${prepared.snapshot.id}`,
          targetData: prepared.targetData,
          action: "create",
          amountInWon: 0,
          sourceAmountInWon: 0,
          logicalCollection: "registered-card",
        }),
      );
    } else if (!fieldsMatch(existingCard, prepared.targetData, cardFields)) {
      unresolved.push(
        migrationIssue({
          code: "CANONICAL_TARGET_CONFLICT",
          sourceCollection: "registered_cards",
          reference: prepared.snapshot.ref.path,
          detailCode: "REGISTERED_CARD_ALREADY_DIFFERS",
        }),
      );
      continue;
    }
    if (prepared.claimId === undefined || prepared.claimData === undefined) {
      continue;
    }
    const existingClaim = input.canonicalCardClaims.get(prepared.claimId);
    const claimFields = [
      "householdId",
      "ownerMemberId",
      "cardCompanyCode",
      "lastFour",
      "cardId",
    ];
    if (existingClaim === undefined) {
      drafts.push(
        candidateDraft(prepared.snapshot, {
          targetPath: `${input.householdPath}/registeredCardClaims/${prepared.claimId}`,
          targetData: prepared.claimData,
          action: "create",
          amountInWon: 0,
          sourceAmountInWon: 0,
          logicalCollection: "registered-card-claim",
        }),
      );
    } else if (!fieldsMatch(existingClaim, prepared.claimData, claimFields)) {
      unresolved.push(
        migrationIssue({
          code: "CANONICAL_TARGET_CONFLICT",
          sourceCollection: "registered_cards",
          reference: prepared.snapshot.ref.path,
          detailCode: "REGISTERED_CARD_CLAIM_ALREADY_DIFFERS",
        }),
      );
    }
  }

  const preparedRules: PreparedMerchantRule[] = [];
  const claimOwners = new Map<string, Set<string>>();
  const registerClaim = (claimId: string, ruleId: string) => {
    const owners = claimOwners.get(claimId) ?? new Set<string>();
    owners.add(ruleId);
    claimOwners.set(claimId, owners);
  };

  for (const [ruleId, data] of input.canonicalMerchantRules) {
    const keyword = text(data, "keyword", "merchantKeyword");
    const matchType = merchantMatchType(data);
    const priority =
      matchType === "exact" ? undefined : positiveInteger(data, 0, "priority");
    if (keyword === "" || (matchType !== "exact" && (priority ?? 0) <= 0)) {
      continue;
    }
    for (const claim of merchantClaims({
      householdId: input.scope.householdId,
      ruleId,
      keyword,
      matchType,
      ...(priority === undefined ? {} : { priority }),
    })) {
      registerClaim(claim.claimId, ruleId);
    }
  }

  for (const snapshot of input.legacyMerchantRules) {
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "merchant_rules",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const keyword = text(data, "keyword", "merchantKeyword");
    if (keyword === "") {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "merchant_rules",
          reference: snapshot.ref.path,
          detailCode: "EMPTY_MERCHANT_KEYWORD",
        }),
      );
      continue;
    }
    const normalizedKeywords = [
      ...new Set(normalizedMerchantKeywordTokens(keyword)),
    ];
    if (normalizedKeywords.some((token) => token === "")) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "merchant_rules",
          reference: snapshot.ref.path,
          detailCode: "EMPTY_MERCHANT_OR_TOKEN",
        }),
      );
      continue;
    }
    if (text(data, "matchType") === "regex") {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "merchant_rules",
          reference: snapshot.ref.path,
          detailCode: "REGEX_MERCHANT_RULE_NOT_SUPPORTED",
        }),
      );
      continue;
    }
    const matchType = merchantMatchType(data);
    const rawPriority = numberValue(data, Number.NaN, "priority");
    const mappedPriority = input.mappings.merchantRulePriorities?.[snapshot.id];
    const priority =
      matchType === "exact"
        ? undefined
        : Number.isSafeInteger(rawPriority) && rawPriority > 0
          ? rawPriority
          : mappedPriority;
    if (
      matchType !== "exact" &&
      (!Number.isSafeInteger(priority) || (priority as number) <= 0)
    ) {
      unresolved.push(
        migrationIssue({
          code: "MERCHANT_RULE_PRIORITY_MAPPING_REQUIRED",
          sourceCollection: "merchant_rules",
          reference: snapshot.ref.path,
          requiredManifestField: "merchantRulePriorities",
          detailCode: "NON_EXACT_POSITIVE_PRIORITY_REQUIRED",
        }),
      );
      continue;
    }
    // 구형 문서는 모든 규칙에 priority를 저장했습니다. exact 규칙의 priority는
    // 당시에도 선택 결과에 영향을 주지 않은 호환 필드이므로 canonical 문서로
    // 옮기지 않습니다. 신규 Command 경계에서는 exact+priority 입력을 계속 거부합니다.
    const rawMapping = objectValue(data, "mapping");
    const merchant = text(rawMapping, "merchant");
    const categoryId =
      text(rawMapping, "categoryId", "category") || text(data, "category");
    const memo = text(rawMapping, "memo");
    const mapping = {
      ...(merchant === "" ? {} : { merchant }),
      ...(categoryId === "" ? {} : { categoryId }),
      ...(memo === "" ? {} : { memo }),
    };
    const timestamps = createdAndUpdated(data, input.plannedAt);
    const targetData = {
      householdId: input.scope.householdId,
      ruleId: snapshot.id,
      keyword,
      merchantKeyword: keyword,
      normalizedKeywords,
      matchType,
      ...(priority === undefined ? {} : { priority }),
      mapping,
      active: data.active === false || data.isActive === false ? false : true,
      isActive: data.active === false || data.isActive === false ? false : true,
      aggregateVersion: Math.max(
        1,
        positiveInteger(data, 1, "aggregateVersion", "version"),
      ),
      schemaVersion: 2,
      ...timestamps,
    };
    const claims = merchantClaims({
      householdId: input.scope.householdId,
      ruleId: snapshot.id,
      keyword,
      matchType,
      ...(priority === undefined ? {} : { priority }),
    }).map((claim) => ({
      ...claim,
      data: { ...claim.data, createdAt: timestamps.createdAt },
    }));
    for (const claim of claims) registerClaim(claim.claimId, snapshot.id);
    preparedRules.push({ snapshot, targetData, claims });
  }

  for (const prepared of preparedRules) {
    if (
      prepared.claims.some(
        ({ claimId }) => (claimOwners.get(claimId)?.size ?? 0) > 1,
      )
    ) {
      unresolved.push(
        migrationIssue({
          code: "MERCHANT_RULE_CLAIM_CONFLICT",
          sourceCollection: "merchant_rules",
          reference: prepared.snapshot.ref.path,
          detailCode: "DUPLICATE_MERCHANT_RULE_CLAIM",
        }),
      );
      continue;
    }
    const existingRule = input.canonicalMerchantRules.get(prepared.snapshot.id);
    const ruleFields = [
      "householdId",
      "ruleId",
      "keyword",
      "merchantKeyword",
      "normalizedKeywords",
      "matchType",
      "priority",
      "mapping",
      "active",
      "isActive",
      "aggregateVersion",
      "schemaVersion",
    ];
    if (existingRule === undefined) {
      drafts.push(
        candidateDraft(prepared.snapshot, {
          targetPath: `${input.householdPath}/merchantRules/${prepared.snapshot.id}`,
          targetData: prepared.targetData,
          action: "create",
          amountInWon: 0,
          sourceAmountInWon: 0,
          logicalCollection: "merchant-rule",
        }),
      );
    } else if (!fieldsMatch(existingRule, prepared.targetData, ruleFields)) {
      unresolved.push(
        migrationIssue({
          code: "CANONICAL_TARGET_CONFLICT",
          sourceCollection: "merchant_rules",
          reference: prepared.snapshot.ref.path,
          detailCode: "MERCHANT_RULE_ALREADY_DIFFERS",
        }),
      );
      continue;
    }
    for (const claim of prepared.claims) {
      const existingClaim = input.canonicalMerchantClaims.get(claim.claimId);
      const claimFields =
        claim.data.kind === "exact"
          ? ["householdId", "kind", "token", "ruleId"]
          : ["householdId", "kind", "matchType", "priority", "ruleId"];
      if (existingClaim === undefined) {
        drafts.push(
          candidateDraft(prepared.snapshot, {
            targetPath: `${input.householdPath}/merchantRuleClaims/${claim.claimId}`,
            targetData: claim.data,
            action: "create",
            amountInWon: 0,
            sourceAmountInWon: 0,
            logicalCollection: "merchant-rule-claim",
          }),
        );
      } else if (!fieldsMatch(existingClaim, claim.data, claimFields)) {
        unresolved.push(
          migrationIssue({
            code: "CANONICAL_TARGET_CONFLICT",
            sourceCollection: "merchant_rules",
            reference: prepared.snapshot.ref.path,
            detailCode: "MERCHANT_RULE_CLAIM_ALREADY_DIFFERS",
          }),
        );
      }
    }
  }

  return { drafts, unresolved };
}
