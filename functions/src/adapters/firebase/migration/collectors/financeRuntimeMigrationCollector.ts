import type * as firestore from "firebase-admin/firestore";

import { runtimeMigrationHash } from "../../../../operations/migration/public";
import {
  candidateDraft,
  createdAndUpdated,
  iso,
  legacySchemaInScope,
  lifecycle,
  migrationIssue,
  nonNegativeWon,
  numberValue,
  positiveInteger,
  resolveMember,
  text,
  type MigrationDocumentData,
  type RuntimeMigrationCandidateDraft,
  type RuntimeMigrationCollectorIssue,
  type RuntimeMigrationCollectorResult,
  type RuntimeMigrationCollectorScope,
} from "./runtimeMigrationCollectorContract";

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
  return result.length === 0 ? undefined : result;
}

function recordList(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.flatMap((item) => {
    const record = recordValue(item);
    return record === undefined ? [] : [record];
  });
  return result.length === 0 ? undefined : result;
}

function ledgerLifecycle(
  data: MigrationDocumentData,
): "active" | "superseded" | "deleted" {
  return data.lifecycleState === "superseded" ? "superseded" : lifecycle(data);
}

const LEGACY_CAPTURED_CARD_TYPES = new Set([
  "captured",
  "family",
  "kb",
  "sam",
  "local_currency",
  "지역화폐",
  "bill",
]);

const LEGACY_MANUAL_SOURCES = new Set([
  "",
  "manual",
  "web-manual",
  "recurring",
  "legacy-migration",
]);

function isMeaningfulLegacyCardDisplay(value: string): boolean {
  const normalized = value.replace(/\s+/g, "");
  return (
    normalized !== "" &&
    normalized !== "수동" &&
    normalized !== "자동등록" &&
    normalized !== "정기지출" &&
    /[0-9xX*＊]{4}\)?$/u.test(normalized)
  );
}

function legacyCardType(data: MigrationDocumentData): "captured" | "manual" {
  const rawCardType = text(data, "cardType").trim().toLowerCase();
  const rawSource = text(data, "source").trim().toLowerCase();
  const rawCardDisplay = text(
    data,
    "cardDisplay",
    "cardName",
    "cardLastFour",
    "lastFour",
  );
  const hasCapturedSource = !LEGACY_MANUAL_SOURCES.has(rawSource);

  if (rawCardType === "manual") return "manual";
  if (LEGACY_CAPTURED_CARD_TYPES.has(rawCardType)) return "captured";
  if (rawCardType === "main") {
    return isMeaningfulLegacyCardDisplay(rawCardDisplay) || hasCapturedSource
      ? "captured"
      : "manual";
  }
  if (rawCardType === "") return hasCapturedSource ? "captured" : "manual";

  // 알 수 없는 과거 값은 카드 결제로 오인하지 않도록 수동 입력으로 둔다.
  return "manual";
}

export interface FinanceRuntimeMigrationCollectorInput
  extends RuntimeMigrationCollectorScope {
  readonly memberIds: ReadonlySet<string>;
  readonly householdSnapshot: firestore.DocumentSnapshot;
  readonly legacyLedger: readonly firestore.QueryDocumentSnapshot[];
  readonly legacyCategories: readonly firestore.QueryDocumentSnapshot[];
  readonly legacyRecurring: readonly firestore.QueryDocumentSnapshot[];
  readonly canonicalLedger: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalCategories: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalRecurring: ReadonlyMap<string, MigrationDocumentData>;
  readonly hasCategorySettings: boolean;
}

export function collectFinanceRuntimeMigration(
  input: FinanceRuntimeMigrationCollectorInput,
): RuntimeMigrationCollectorResult {
  const drafts: RuntimeMigrationCandidateDraft[] = [];
  const unresolved: RuntimeMigrationCollectorIssue[] = [];

  for (const snapshot of input.legacyLedger) {
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "expenses",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const rawCreator = text(data, "creatorMemberId", "createdBy");
    const creator = resolveMember({
      raw: rawCreator,
      documentId: snapshot.id,
      explicitByDocument: input.mappings.ledgerCreators,
      missingRawFallback: input.mappings.missingCreatorMemberId,
      mappings: input.mappings,
      memberIds: input.memberIds,
    });
    if (creator === undefined) {
      unresolved.push(
        migrationIssue({
          code:
            rawCreator === ""
              ? "LEDGER_CREATOR_MAPPING_REQUIRED"
              : "LEGACY_MEMBER_MAPPING_REQUIRED",
          sourceCollection: "expenses",
          reference: snapshot.ref.path,
          requiredManifestField:
            rawCreator === "" ? "ledgerCreators" : "memberReferences",
        }),
      );
      continue;
    }
    const legacyNotification = recordValue(data.notificationRequest);
    const hasNotificationRequest =
      data.notificationRequest !== undefined ||
      data.notifyPartnerAt !== undefined ||
      data.notifyPartnerBy !== undefined;
    const rawNotificationRequester =
      text(legacyNotification, "requesterMemberId") ||
      text(data, "notifyPartnerBy");
    const notificationRequester = hasNotificationRequest
      ? resolveMember({
          raw: rawNotificationRequester,
          documentId: snapshot.id,
          explicitByDocument: input.mappings.ledgerNotificationRequesters,
          mappings: input.mappings,
          memberIds: input.memberIds,
        })
      : undefined;
    const notificationRequestedAt = hasNotificationRequest
      ? iso(legacyNotification?.requestedAt ?? data.notifyPartnerAt, "")
      : "";
    if (hasNotificationRequest && notificationRequester === undefined) {
      unresolved.push(
        migrationIssue({
          code: "LEDGER_NOTIFICATION_REQUESTER_MAPPING_REQUIRED",
          sourceCollection: "expenses",
          reference: snapshot.ref.path,
          requiredManifestField: "ledgerNotificationRequesters",
        }),
      );
      continue;
    }
    if (hasNotificationRequest && notificationRequestedAt === "") {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "expenses",
          reference: snapshot.ref.path,
          detailCode: "INVALID_NOTIFICATION_REQUEST_TIME",
        }),
      );
      continue;
    }
    const amountInWon = nonNegativeWon(
      numberValue(data, 0, "amountInWon", "amount"),
    );
    const transactionType =
      data.transactionType === "income" ? "income" : "expense";
    const timestamps = createdAndUpdated(data, input.plannedAt);
    const cardType = legacyCardType(data);
    const cardDisplay =
      text(data, "cardDisplay", "cardName", "cardLastFour", "lastFour") ||
      (cardType === "manual" ? "수동" : "자동 수집");
    const nestedSplitGroup = recordValue(data.splitGroup);
    const splitGroupId = text(data, "splitGroupId");
    const splitGroup =
      nestedSplitGroup ??
      (splitGroupId === ""
        ? undefined
        : {
            groupId: splitGroupId,
            index: numberValue(data, 0, "splitIndex"),
            total: numberValue(data, 0, "splitTotal"),
            originalId: text(data, "splitOriginalId"),
          });
    const mergedFrom = Array.isArray(data.mergedFrom)
      ? data.mergedFrom
      : undefined;
    const mergeLeafIds = stringList(data.mergeLeafIds);
    const intermediateMergeHistoryIds = stringList(
      data.intermediateMergeHistoryIds,
    );
    const mergeLeafSnapshots = recordList(data.mergeLeafSnapshots);
    const sourceFingerprint = text(data, "sourceFingerprint");
    const captureLineageId =
      text(data, "captureLineageId", "sourceFingerprint") ||
      `legacy:${snapshot.id}`;
    const cardEvidence =
      text(data, "cardEvidence", "captureCardEvidence") || cardDisplay;
    const localCurrencyType = text(data, "localCurrencyType");
    const derivedFromTransactionId = text(data, "derivedFromTransactionId");
    const cardLastFour = text(data, "cardLastFour", "lastFour");
    const targetData = {
      householdId: input.scope.householdId,
      transactionId: snapshot.id,
      transactionType,
      merchant:
        text(data, "merchant") ||
        (transactionType === "income" ? "수입" : ""),
      memo: text(data, "memo"),
      amountInWon,
      amount: amountInWon,
      categoryId: text(data, "categoryId", "category") || "etc",
      category: text(data, "categoryId", "category") || "etc",
      accountingDate: text(data, "accountingDate", "date"),
      date: text(data, "accountingDate", "date"),
      localTime: text(data, "localTime", "time") || "00:00",
      time: text(data, "localTime", "time") || "00:00",
      cardDisplay,
      cardType,
      creatorMemberId: creator,
      lifecycleState: ledgerLifecycle(data),
      aggregateVersion: Math.max(
        1,
        positiveInteger(data, 1, "aggregateVersion"),
      ),
      source: text(data, "source") || "legacy-migration",
      originChannel: text(data, "originChannel") || "legacy-migration",
      cardEvidence,
      captureLineageId,
      ...(sourceFingerprint === "" ? {} : { sourceFingerprint }),
      ...(localCurrencyType === "" ? {} : { localCurrencyType }),
      ...(derivedFromTransactionId === ""
        ? {}
        : { derivedFromTransactionId }),
      ...(cardLastFour === "" ? {} : { cardLastFour }),
      ...(notificationRequester === undefined
        ? {}
        : {
            notificationRequest: {
              requesterMemberId: notificationRequester,
              requestedAt: notificationRequestedAt,
            },
          }),
      ...(splitGroup === undefined ? {} : { splitGroup }),
      ...(splitGroupId === ""
        ? {}
        : {
            splitGroupId,
            splitIndex: numberValue(data, 0, "splitIndex"),
            splitTotal: numberValue(data, 0, "splitTotal"),
            splitOriginalId: text(data, "splitOriginalId"),
          }),
      ...(mergedFrom === undefined ? {} : { mergedFrom }),
      ...(mergeLeafIds === undefined ? {} : { mergeLeafIds }),
      ...(intermediateMergeHistoryIds === undefined
        ? {}
        : { intermediateMergeHistoryIds }),
      ...(mergeLeafSnapshots === undefined ? {} : { mergeLeafSnapshots }),
      schemaVersion: 2,
      ...timestamps,
    };
    const existing = input.canonicalLedger.get(snapshot.id);
    if (existing === undefined) {
      drafts.push(
        candidateDraft(snapshot, {
          targetPath: `${input.householdPath}/ledgerTransactions/${snapshot.id}`,
          targetData,
          action: "create",
          amountInWon,
          sourceAmountInWon: amountInWon,
          logicalCollection: "ledger",
        }),
      );
    } else if (text(existing, "creatorMemberId") === "") {
      drafts.push(
        candidateDraft(snapshot, {
          targetPath: `${input.householdPath}/ledgerTransactions/${snapshot.id}`,
          targetData: { creatorMemberId: creator },
          action: "merge-missing",
          amountInWon,
          sourceAmountInWon: amountInWon,
          logicalCollection: "ledger",
        }),
      );
    }
  }

  for (const snapshot of input.legacyCategories) {
    if (input.canonicalCategories.has(snapshot.id)) continue;
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "categories",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const name = text(data, "name", "label");
    const color = text(data, "color");
    if (name === "" || color === "") {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "categories",
          reference: snapshot.ref.path,
          detailCode: "CATEGORY_NAME_OR_COLOR_MISSING",
        }),
      );
      continue;
    }
    const budgetCandidate = data.budgetInWon ?? data.budget;
    const budgetInWon =
      budgetCandidate === null || Number.isSafeInteger(budgetCandidate)
        ? (budgetCandidate as number | null)
        : null;
    drafts.push(
      candidateDraft(snapshot, {
        targetPath: `${input.householdPath}/categories/${snapshot.id}`,
        targetData: {
          householdId: input.scope.householdId,
          categoryId: text(data, "categoryId", "key") || snapshot.id,
          name,
          color,
          budgetInWon,
          state:
            data.state === "archived" || data.isActive === false
              ? "archived"
              : "active",
          sortOrder: positiveInteger(data, 0, "sortOrder", "order"),
          version: Math.max(
            1,
            positiveInteger(data, 1, "version", "aggregateVersion"),
          ),
          aggregateVersion: Math.max(
            1,
            positiveInteger(data, 1, "version", "aggregateVersion"),
          ),
          schemaVersion: 2,
          ...createdAndUpdated(data, input.plannedAt),
        },
        action: "create",
        amountInWon: budgetInWon ?? 0,
        sourceAmountInWon: budgetInWon ?? 0,
        logicalCollection: "category",
      }),
    );
  }

  if (!input.hasCategorySettings && input.legacyCategories.length > 0) {
    const defaults = input.legacyCategories.filter(
      (snapshot) =>
        legacySchemaInScope(snapshot.data()) &&
        snapshot.data().isDefault === true,
    );
    const legacyDefaultCategoryId = text(
      input.householdSnapshot.data(),
      "defaultCategoryId",
      "defaultCategoryKey",
    );
    const selectedId =
      input.mappings.defaultCategoryId ??
      (legacyDefaultCategoryId === ""
        ? defaults[0]?.id
        : legacyDefaultCategoryId);
    const selected = input.legacyCategories.find(
      (snapshot) =>
        legacySchemaInScope(snapshot.data()) &&
        (snapshot.id === selectedId ||
          text(snapshot.data(), "categoryId", "key") === selectedId),
    );
    if (
      selected === undefined ||
      (input.mappings.defaultCategoryId === undefined &&
        legacyDefaultCategoryId === "" &&
        defaults.length !== 1)
    ) {
      unresolved.push(
        migrationIssue({
          code: "CATEGORY_DEFAULT_MAPPING_REQUIRED",
          sourceCollection: "categories",
          reference: `${input.scope.householdId}:category-default`,
          requiredManifestField: "defaultCategoryId",
        }),
      );
    } else {
      drafts.push(
        candidateDraft(
          input.mappings.defaultCategoryId === undefined &&
            legacyDefaultCategoryId !== ""
            ? input.householdSnapshot
            : selected,
          {
            targetPath: `${input.householdPath}/categorySettings/default`,
            targetData: {
              defaultCategoryId:
                text(selected.data(), "categoryId", "key") || selected.id,
              catalogVersion: 1,
              aggregateVersion: 1,
              schemaVersion: 2,
              ...createdAndUpdated(selected.data(), input.plannedAt),
            },
            action: "create",
            amountInWon: 0,
            sourceAmountInWon: 0,
            logicalCollection: "category-setting",
          },
        ),
      );
    }
  }

  for (const snapshot of input.legacyRecurring) {
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "recurring_expenses",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const rawCreator = text(data, "creatorMemberId", "createdBy");
    const explicitCreator = input.mappings.recurringCreators?.[snapshot.id];
    const creator = resolveMember({
      raw: rawCreator,
      documentId: snapshot.id,
      explicitByDocument: input.mappings.recurringCreators,
      missingRawFallback: input.mappings.missingCreatorMemberId,
      mappings: input.mappings,
      memberIds: input.memberIds,
    });
    if (creator === undefined) {
      unresolved.push(
        migrationIssue({
          code: "RECURRING_CREATOR_MAPPING_REQUIRED",
          sourceCollection: "recurring_expenses",
          reference: snapshot.ref.path,
          requiredManifestField: "recurringCreators",
        }),
      );
      continue;
    }
    const existing = input.canonicalRecurring.get(snapshot.id);
    const existingCreator = text(existing, "creatorMemberId");
    if (existingCreator !== "" && existingCreator !== creator) {
      unresolved.push(
        migrationIssue({
          code: "CANONICAL_TARGET_CONFLICT",
          sourceCollection: "recurring_expenses",
          reference: snapshot.ref.path,
          detailCode: "RECURRING_CREATOR_ALREADY_DIFFERS",
        }),
      );
      continue;
    }
    const amountInWon = nonNegativeWon(
      numberValue(data, 0, "amountInWon", "amount"),
    );
    const legacyLastProcessedMonth = text(
      data,
      "lastProcessedMonth",
      "lastRegisteredMonth",
    );
    const timestamps = createdAndUpdated(data, input.plannedAt);
    const version = Math.max(
      1,
      positiveInteger(data, 1, "version", "aggregateVersion"),
    );
    if (existing === undefined) {
      drafts.push(
        candidateDraft(snapshot, {
          targetPath: `${input.householdPath}/recurringPlans/${snapshot.id}`,
          targetData: {
            householdId: input.scope.householdId,
            planId: snapshot.id,
            merchant: text(data, "merchant"),
            amountInWon,
            categoryId: text(data, "categoryId", "category") || "etc",
            dayOfMonth: positiveInteger(data, 1, "dayOfMonth"),
            memo: text(data, "memo"),
            active:
              data.active === false || data.isActive === false ? false : true,
            creatorMemberId: creator,
            firstApplicableMonth:
              text(data, "firstApplicableMonth") ||
              timestamps.createdAt.slice(0, 7),
            ...(legacyLastProcessedMonth === ""
              ? {}
              : { lastProcessedMonth: legacyLastProcessedMonth }),
            lifecycleState: lifecycle(data),
            version,
            aggregateVersion: version,
            schemaVersion: 2,
            ...timestamps,
          },
          action: "create",
          amountInWon,
          sourceAmountInWon: amountInWon,
          logicalCollection: "recurring",
        }),
      );
    } else {
      const existingLastProcessedMonth = text(existing, "lastProcessedMonth");
      if (
        legacyLastProcessedMonth !== "" &&
        existingLastProcessedMonth !== "" &&
        existingLastProcessedMonth !== legacyLastProcessedMonth
      ) {
        unresolved.push(
          migrationIssue({
            code: "CANONICAL_TARGET_CONFLICT",
            sourceCollection: "recurring_expenses",
            reference: snapshot.ref.path,
            detailCode: "RECURRING_LAST_PROCESSED_MONTH_ALREADY_DIFFERS",
          }),
        );
        continue;
      }
      const missingFields = {
        ...(existingCreator === "" ? { creatorMemberId: creator } : {}),
        ...(legacyLastProcessedMonth !== "" && existingLastProcessedMonth === ""
          ? { lastProcessedMonth: legacyLastProcessedMonth }
          : {}),
      };
      if (Object.keys(missingFields).length > 0) {
        drafts.push(
          candidateDraft(snapshot, {
            targetPath: `${input.householdPath}/recurringPlans/${snapshot.id}`,
            targetData: missingFields,
            action: "merge-missing",
            amountInWon,
            sourceAmountInWon: amountInWon,
            logicalCollection: "recurring",
          }),
        );
      }
    }
    if (explicitCreator !== undefined || rawCreator === "") {
      const receiptId = runtimeMigrationHash({
        planId: snapshot.id,
        creator,
        migrationId: input.scope.migrationId,
      });
      drafts.push(
        candidateDraft(snapshot, {
          targetPath: `${input.householdPath}/recurringCreatorMigrationReceipts/${receiptId}`,
          targetData: {
            receiptId,
            commandId: receiptId,
            householdId: input.scope.householdId,
            planId: snapshot.id,
            creatorMemberId: creator,
            migrationActorId: input.scope.operatorId,
            migratedAt: input.plannedAt,
            previousPlanVersion: version,
            schemaVersion: 1,
          },
          action: "create",
          amountInWon: 0,
          sourceAmountInWon: amountInWon,
          logicalCollection: "recurring-creator-receipt",
        }),
      );
    }
  }

  return { drafts, unresolved };
}
