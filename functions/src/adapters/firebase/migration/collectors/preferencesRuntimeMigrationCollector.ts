import type * as firestore from "firebase-admin/firestore";

import {
  candidateDraft,
  createdAndUpdated,
  fieldsMatch,
  iso,
  legacySchemaInScope,
  migrationIssue,
  objectValue,
  positiveInteger,
  rawSha256,
  sourceFingerprint,
  text,
  type MigrationDocumentData,
  type RuntimeMigrationCandidateDraft,
  type RuntimeMigrationCollectorIssue,
  type RuntimeMigrationCollectorResult,
  type RuntimeMigrationCollectorScope,
} from "./runtimeMigrationCollectorContract";

const SUPPORTED_LOCAL_CURRENCY_TYPES = new Set([
  "gyeonggi",
  "daejeon",
  "sejong",
]);

const WEB_TO_CANONICAL_HOME_CARD: Readonly<Record<string, string>> = {
  localCurrencyBalance: "LOCAL_CURRENCY_BALANCE",
  monthlyRemainingBudget: "MONTHLY_REMAINING_BUDGET",
  monthlySpent: "MONTHLY_EXPENSE",
  yearlySpent: "YEARLY_EXPENSE",
};

export interface PreferencesRuntimeMigrationCollectorInput
  extends RuntimeMigrationCollectorScope {
  readonly householdSnapshot: firestore.DocumentSnapshot;
  readonly legacyBalances: readonly firestore.QueryDocumentSnapshot[];
  readonly canonicalBalances: ReadonlyMap<string, MigrationDocumentData>;
  readonly homePreference?: firestore.QueryDocumentSnapshot;
}

function canonicalHomeCard(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return (
    WEB_TO_CANONICAL_HOME_CARD[value] ??
    (Object.values(WEB_TO_CANONICAL_HOME_CARD).includes(value)
      ? value
      : fallback)
  );
}

export function collectPreferencesRuntimeMigration(
  input: PreferencesRuntimeMigrationCollectorInput,
): RuntimeMigrationCollectorResult {
  const drafts: RuntimeMigrationCandidateDraft[] = [];
  const unresolved: RuntimeMigrationCollectorIssue[] = [];
  const balancesByType = new Map<
    string,
    firestore.QueryDocumentSnapshot[]
  >();

  for (const snapshot of input.legacyBalances) {
    const data = snapshot.data();
    if (text(data, "type") !== "localCurrency") continue;
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "balances",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const rawType = text(data, "localCurrencyType", "currencyType");
    const localCurrencyType = SUPPORTED_LOCAL_CURRENCY_TYPES.has(rawType)
      ? rawType
      : input.mappings.localCurrencyTypes?.[snapshot.id];
    if (
      localCurrencyType === undefined ||
      !SUPPORTED_LOCAL_CURRENCY_TYPES.has(localCurrencyType)
    ) {
      unresolved.push(
        migrationIssue({
          code: "LOCAL_CURRENCY_TYPE_MAPPING_REQUIRED",
          sourceCollection: "balances",
          reference: snapshot.ref.path,
          requiredManifestField: "localCurrencyTypes",
        }),
      );
      continue;
    }
    const grouped = balancesByType.get(localCurrencyType) ?? [];
    grouped.push(snapshot);
    balancesByType.set(localCurrencyType, grouped);
  }

  const resolvedBalanceTypes = new Set(input.canonicalBalances.keys());
  for (const [localCurrencyType, snapshots] of balancesByType) {
    let selected: firestore.QueryDocumentSnapshot | undefined = snapshots[0];
    if (snapshots.length > 1) {
      const preferredId =
        input.mappings.localCurrencyPreferredDocuments?.[localCurrencyType];
      selected = snapshots.find(({ id }) => id === preferredId);
      if (selected === undefined) {
        for (const snapshot of snapshots) {
          unresolved.push(
            migrationIssue({
              code: "LOCAL_CURRENCY_DUPLICATE_SELECTION_REQUIRED",
              sourceCollection: "balances",
              reference: snapshot.ref.path,
              requiredManifestField: "localCurrencyPreferredDocuments",
              detailCode: "MULTIPLE_DOCUMENTS_FOR_ONE_CURRENCY_TYPE",
            }),
          );
        }
        continue;
      }
    }
    if (selected === undefined) continue;
    const data = selected.data();
    const rawBalance =
      data.balanceInWon !== undefined ? data.balanceInWon : data.balance;
    if (typeof rawBalance !== "number" || !Number.isSafeInteger(rawBalance)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "balances",
          reference: selected.ref.path,
          detailCode: "BALANCE_MUST_BE_SAFE_INTEGER",
        }),
      );
      continue;
    }
    const observedAt = iso(
      data.observedAt ?? data.updatedAt,
      new Date(0).toISOString(),
    );
    const updatedAt = iso(data.updatedAt, observedAt);
    const fingerprint = sourceFingerprint(selected);
    const targetData = {
      balanceId: `local-currency-balance:v2:${encodeURIComponent(
        input.scope.householdId,
      )}:${localCurrencyType}`,
      householdId: input.scope.householdId,
      localCurrencyType,
      ...(text(data, "displayName") === ""
        ? {}
        : { displayName: text(data, "displayName") }),
      balanceInWon: rawBalance,
      observedAt,
      updatedAt,
      updatedAtIso: updatedAt,
      balanceVersion: Math.max(
        1,
        positiveInteger(data, 1, "balanceVersion"),
      ),
      lastObservationId: `migration-${rawSha256(
        `${selected.ref.path}\u0000${fingerprint}`,
      ).slice(0, 32)}`,
      schemaVersion: 2,
      createdAt: iso(data.createdAt, observedAt),
    };
    const existing = input.canonicalBalances.get(localCurrencyType);
    const balanceFields = [
      "balanceId",
      "householdId",
      "localCurrencyType",
      "displayName",
      "balanceInWon",
      "observedAt",
      "balanceVersion",
      "schemaVersion",
    ];
    if (existing === undefined) {
      drafts.push(
        candidateDraft(selected, {
          targetPath: `${input.householdPath}/localCurrencyBalances/${localCurrencyType}`,
          targetData,
          action: "create",
          amountInWon: rawBalance,
          sourceAmountInWon: rawBalance,
          logicalCollection: "local-currency-balance",
        }),
      );
    } else if (!fieldsMatch(existing, targetData, balanceFields)) {
      unresolved.push(
        migrationIssue({
          code: "CANONICAL_TARGET_CONFLICT",
          sourceCollection: "balances",
          reference: selected.ref.path,
          detailCode: "LOCAL_CURRENCY_BALANCE_ALREADY_DIFFERS",
        }),
      );
      continue;
    }
    resolvedBalanceTypes.add(localCurrencyType);
  }

  const householdData = input.householdSnapshot.data() ?? {};
  const legacyHome = objectValue(householdData, "homeSummaryConfig");
  const rawSelectedType = text(
    householdData,
    "selectedLocalCurrencyType",
    "selectedLocalCurrencyTypeId",
  );
  const onlyResolvedType =
    resolvedBalanceTypes.size === 1
      ? [...resolvedBalanceTypes][0]
      : undefined;
  const selectedLocalCurrencyType =
    rawSelectedType === ""
      ? input.mappings.homeSelectedLocalCurrencyType ?? onlyResolvedType
      : SUPPORTED_LOCAL_CURRENCY_TYPES.has(rawSelectedType)
        ? rawSelectedType
        : input.mappings.homeSelectedLocalCurrencyType;
  if (
    rawSelectedType !== "" &&
    (selectedLocalCurrencyType === undefined ||
      !SUPPORTED_LOCAL_CURRENCY_TYPES.has(selectedLocalCurrencyType))
  ) {
    unresolved.push(
      migrationIssue({
        code: "HOME_LOCAL_CURRENCY_SELECTION_MAPPING_REQUIRED",
        sourceCollection: "households",
        reference: input.householdSnapshot.ref.path,
        requiredManifestField: "homeSelectedLocalCurrencyType",
      }),
    );
  } else if (
    selectedLocalCurrencyType !== undefined &&
    !resolvedBalanceTypes.has(selectedLocalCurrencyType)
  ) {
    unresolved.push(
      migrationIssue({
        code: "HOME_LOCAL_CURRENCY_SELECTION_MAPPING_REQUIRED",
        sourceCollection: "households",
        reference: input.householdSnapshot.ref.path,
        requiredManifestField: "homeSelectedLocalCurrencyType",
        detailCode: "SELECTED_LOCAL_CURRENCY_BALANCE_NOT_IN_SCOPE",
      }),
    );
  } else {
    const targetData = {
      householdId: input.scope.householdId,
      left: canonicalHomeCard(
        legacyHome.leftCard,
        "LOCAL_CURRENCY_BALANCE",
      ),
      right: canonicalHomeCard(
        legacyHome.rightCard,
        "MONTHLY_REMAINING_BUDGET",
      ),
      ...(selectedLocalCurrencyType === undefined
        ? {}
        : { selectedLocalCurrencyType }),
      aggregateVersion: positiveInteger(
        householdData,
        0,
        "homeSummaryConfigVersion",
      ),
      schemaVersion: 2,
      ...createdAndUpdated(householdData, input.plannedAt),
    };
    const preferenceFields = [
      "householdId",
      "left",
      "right",
      "selectedLocalCurrencyType",
      "aggregateVersion",
      "schemaVersion",
    ];
    if (input.homePreference === undefined) {
      drafts.push(
        candidateDraft(input.householdSnapshot, {
          targetPath: `${input.householdPath}/homePreferences/home`,
          targetData,
          action: "create",
          amountInWon: 0,
          sourceAmountInWon: 0,
          logicalCollection: "home-preference",
        }),
      );
    } else if (
      !fieldsMatch(input.homePreference.data(), targetData, preferenceFields)
    ) {
      unresolved.push(
        migrationIssue({
          code: "CANONICAL_TARGET_CONFLICT",
          sourceCollection: "households",
          reference: input.householdSnapshot.ref.path,
          detailCode: "HOME_PREFERENCE_ALREADY_DIFFERS",
        }),
      );
    }
  }

  return { drafts, unresolved };
}
