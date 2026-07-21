import type * as firestore from "firebase-admin/firestore";

import {
  calculateEffectivePaymentDatePolicy,
  nextYearMonth,
  parseYearMonth,
} from "../../../../contexts/portfolio/automation/public";
import {
  normalizeCanonicalAssetSubType,
  normalizeLoanRepaymentMethod,
} from "../../../../contexts/portfolio/core/public";
import type {
  RuntimeMigrationMappingManifest,
  RuntimeMigrationUnresolved,
} from "../../../../operations/migration/public";
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
  text,
  type MigrationDocumentData,
  type RuntimeMigrationCandidateDraft,
  type RuntimeMigrationCollectorIssue,
  type RuntimeMigrationCollectorResult,
  type RuntimeMigrationCollectorScope,
} from "./runtimeMigrationCollectorContract";

const VALID_ASSET_TYPES = new Set([
  "savings",
  "stock",
  "crypto",
  "property",
  "gold",
  "loan",
]);

export interface PortfolioAssetRuntimeMigrationCollectorInput
  extends RuntimeMigrationCollectorScope {
  readonly profileIds: ReadonlySet<string>;
  readonly legacyAssets: readonly firestore.QueryDocumentSnapshot[];
  readonly canonicalAssets: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalPlans: ReadonlyMap<string, MigrationDocumentData>;
  readonly canonicalRevisions: ReadonlyMap<string, MigrationDocumentData>;
}

function effectiveDate(month: string, day: number): string | undefined {
  const result = calculateEffectivePaymentDatePolicy(month, day);
  return result.kind === "success" ? result.effectiveDate : undefined;
}

function assetOwner(input: {
  data: MigrationDocumentData;
  mappings: RuntimeMigrationMappingManifest;
  profileIds: ReadonlySet<string>;
}):
  | {
      readonly kind: "resolved";
      readonly ownerRef: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "unresolved";
      readonly code: RuntimeMigrationUnresolved["code"];
    } {
  const stored = input.data.ownerRef;
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    const candidate = stored as Record<string, unknown>;
    if (candidate.kind === "household") {
      return { kind: "resolved", ownerRef: { kind: "household" } };
    }
    if (
      candidate.kind === "profile" &&
      typeof candidate.profileId === "string" &&
      input.profileIds.has(candidate.profileId)
    ) {
      return {
        kind: "resolved",
        ownerRef: { kind: "profile", profileId: candidate.profileId },
      };
    }
  }
  const raw = text(input.data, "owner");
  if (raw === "" || raw === "가구") {
    return { kind: "resolved", ownerRef: { kind: "household" } };
  }
  const profileId = input.mappings.assetOwners?.[raw];
  if (profileId === undefined) {
    return { kind: "unresolved", code: "ASSET_OWNER_MAPPING_REQUIRED" };
  }
  if (!input.profileIds.has(profileId)) {
    return { kind: "unresolved", code: "ASSET_OWNER_PROFILE_NOT_FOUND" };
  }
  return {
    kind: "resolved",
    ownerRef: { kind: "profile", profileId },
  };
}

export function collectPortfolioAssetRuntimeMigration(
  input: PortfolioAssetRuntimeMigrationCollectorInput,
): RuntimeMigrationCollectorResult {
  const drafts: RuntimeMigrationCandidateDraft[] = [];
  const unresolved: RuntimeMigrationCollectorIssue[] = [];

  for (const snapshot of input.legacyAssets) {
    const data = snapshot.data();
    if (!legacySchemaInScope(data)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "assets",
          reference: snapshot.ref.path,
          detailCode: "SOURCE_SCHEMA_OUTSIDE_SCOPE",
        }),
      );
      continue;
    }
    const type = text(data, "type");
    if (!VALID_ASSET_TYPES.has(type)) {
      unresolved.push(
        migrationIssue({
          code: "SOURCE_DOCUMENT_INVALID",
          sourceCollection: "assets",
          reference: snapshot.ref.path,
          detailCode: "UNSUPPORTED_ASSET_TYPE",
        }),
      );
      continue;
    }
    const owner = assetOwner({
      data,
      mappings: input.mappings,
      profileIds: input.profileIds,
    });
    if (owner.kind === "unresolved") {
      unresolved.push(
        migrationIssue({
          code: owner.code,
          sourceCollection: "assets",
          reference: snapshot.ref.path,
          requiredManifestField: "assetOwners",
        }),
      );
      continue;
    }
    const currentBalance = nonNegativeWon(
      numberValue(data, 0, "currentBalance"),
    );
    const timestamps = createdAndUpdated(data, input.plannedAt);
    const automation = {
      recurringContributionAmount: positiveInteger(
        data,
        0,
        "recurringContributionAmount",
      ),
      recurringContributionDay: positiveInteger(
        data,
        0,
        "recurringContributionDay",
      ),
      lastAutoContributionMonth: text(data, "lastAutoContributionMonth"),
      loanInterestRate: Math.max(0, numberValue(data, 0, "loanInterestRate")),
      loanRepaymentMethod: text(data, "loanRepaymentMethod"),
      loanMonthlyPaymentAmount: positiveInteger(
        data,
        0,
        "loanMonthlyPaymentAmount",
      ),
      loanPaymentDay: positiveInteger(data, 0, "loanPaymentDay"),
      lastAutoRepaymentMonth: text(data, "lastAutoRepaymentMonth"),
    };
    if (!input.canonicalAssets.has(snapshot.id)) {
      const normalizedSubType = normalizeCanonicalAssetSubType(
        type as "savings" | "stock" | "crypto" | "property" | "gold" | "loan",
        text(data, "subType"),
      )?.canonical;
      drafts.push(
        candidateDraft(snapshot, {
          targetPath: `${input.householdPath}/assets/${snapshot.id}`,
          targetData: {
            householdId: input.scope.householdId,
            assetId: snapshot.id,
            name: text(data, "name") || snapshot.id,
            type,
            ...(normalizedSubType === undefined
              ? {}
              : { subType: normalizedSubType }),
            ownerRef: owner.ownerRef,
            currency: text(data, "currency") === "USD" ? "USD" : "KRW",
            currentBalance,
            ...(typeof data.costBasis === "number"
              ? { costBasis: Math.max(0, Math.round(data.costBasis)) }
              : {}),
            memo: text(data, "memo"),
            order: positiveInteger(data, 0, "order"),
            lifecycleState: lifecycle(data),
            aggregateVersion: Math.max(
              1,
              positiveInteger(data, 1, "aggregateVersion"),
            ),
            ...(data.deletedAt === undefined
              ? {}
              : { deletedAt: iso(data.deletedAt, timestamps.updatedAt) }),
            ...(typeof data.initialInvestment === "number"
              ? {
                  initialInvestment: Math.max(
                    0,
                    Math.round(data.initialInvestment),
                  ),
                }
              : {}),
            ...(typeof data.quantity === "number"
              ? { quantity: Math.max(0, data.quantity) }
              : {}),
            ...(text(data, "stockCode") === ""
              ? {}
              : { stockCode: text(data, "stockCode") }),
            automation,
            schemaVersion: 1,
            ...timestamps,
          },
          action: "create",
          amountInWon: currentBalance,
          sourceAmountInWon: currentBalance,
          logicalCollection: "asset",
        }),
      );
    }

    const automationInputs = [
      {
        operation: "savings-contribution" as const,
        applicable: type === "savings",
        amount: automation.recurringContributionAmount,
        day: automation.recurringContributionDay,
        lastMonth: automation.lastAutoContributionMonth,
        kind: "savings-deposit" as const,
      },
      {
        operation: "loan-repayment" as const,
        applicable: type === "loan",
        amount: automation.loanMonthlyPaymentAmount,
        day: automation.loanPaymentDay,
        lastMonth: automation.lastAutoRepaymentMonth,
        kind: "loan-repayment" as const,
      },
    ];
    for (const automationInput of automationInputs) {
      if (
        !automationInput.applicable ||
        automationInput.amount <= 0 ||
        automationInput.day < 1 ||
        automationInput.day > 31
      ) {
        continue;
      }
      const planId = `${snapshot.id}_${automationInput.operation}`;
      let firstApplicableMonth: string;
      let lastAppliedMonth: string | undefined;
      if (parseYearMonth(automationInput.lastMonth) !== undefined) {
        lastAppliedMonth = automationInput.lastMonth;
        firstApplicableMonth = automationInput.lastMonth;
      } else {
        const explicit =
          input.mappings.assetAutomationFirstApplicableMonths?.[planId];
        if (explicit === undefined || parseYearMonth(explicit) === undefined) {
          unresolved.push(
            migrationIssue({
              code: "ASSET_AUTOMATION_START_MONTH_REQUIRED",
              sourceCollection: "assets",
              reference: `${snapshot.ref.path}:${automationInput.operation}`,
              requiredManifestField: "assetAutomationFirstApplicableMonths",
            }),
          );
          continue;
        }
        firstApplicableMonth = explicit;
      }
      const dueMonth =
        lastAppliedMonth === undefined
          ? firstApplicableMonth
          : nextYearMonth(parseYearMonth(lastAppliedMonth)!);
      const nextDueDate = effectiveDate(dueMonth, automationInput.day);
      if (nextDueDate === undefined) {
        unresolved.push(
          migrationIssue({
            code: "SOURCE_DOCUMENT_INVALID",
            sourceCollection: "assets",
            reference: `${snapshot.ref.path}:${automationInput.operation}`,
            detailCode: "INVALID_AUTOMATION_DUE_DATE",
          }),
        );
        continue;
      }
      const normalizedRepaymentMethod =
        automationInput.operation === "loan-repayment"
          ? normalizeLoanRepaymentMethod(automation.loanRepaymentMethod)
          : undefined;
      if (
        automationInput.operation === "loan-repayment" &&
        normalizedRepaymentMethod === undefined
      ) {
        unresolved.push(
          migrationIssue({
            code: "SOURCE_DOCUMENT_INVALID",
            sourceCollection: "assets",
            reference: `${snapshot.ref.path}:${automationInput.operation}`,
            detailCode: "UNSUPPORTED_LOAN_REPAYMENT_METHOD",
          }),
        );
        continue;
      }
      const planData = {
        planId,
        householdId: input.scope.householdId,
        assetId: snapshot.id,
        operation: automationInput.operation,
        kind: automationInput.kind,
        status: lifecycle(data) === "active" ? "active" : "suspended",
        amountInWon: automationInput.amount,
        configuredDay: automationInput.day,
        firstActivatedOn: `${firstApplicableMonth}-01`,
        activationMonthDisposition: "applicable",
        firstApplicableMonth,
        nextDueDate,
        ...(lastAppliedMonth === undefined ? {} : { lastAppliedMonth }),
        ...(normalizedRepaymentMethod === undefined
          ? {}
          : { repaymentMethod: normalizedRepaymentMethod }),
        ...(automationInput.operation === "loan-repayment"
          ? { annualInterestRate: automation.loanInterestRate }
          : {}),
        currentRevision: 1,
        aggregateVersion: 1,
        schemaVersion: 1,
        ...timestamps,
      };
      const existingPlan = input.canonicalPlans.get(planId);
      if (existingPlan === undefined) {
        drafts.push(
          candidateDraft(snapshot, {
            targetPath: `${input.householdPath}/assetAutomationPlans/${planId}`,
            targetData: planData,
            action: "create",
            amountInWon: automationInput.amount,
            sourceAmountInWon: currentBalance,
            logicalCollection: "asset-automation-plan",
          }),
        );
      }
      const revision =
        existingPlan === undefined
          ? 1
          : Math.max(
              1,
              positiveInteger(existingPlan, 1, "currentRevision"),
            );
      const revisionId = `${planId}_${revision}`;
      if (input.canonicalRevisions.has(revisionId)) continue;
      const revisionSource = existingPlan ?? planData;
      const revisionData = {
        revisionId,
        planId,
        householdId: input.scope.householdId,
        assetId: snapshot.id,
        operation: automationInput.operation,
        revision,
        effectiveFrom: `${
          text(revisionSource, "firstApplicableMonth") || firstApplicableMonth
        }-01T00:00:00+09:00`,
        amountInWon: positiveInteger(
          revisionSource,
          automationInput.amount,
          "amountInWon",
        ),
        configuredDay: positiveInteger(
          revisionSource,
          automationInput.day,
          "configuredDay",
        ),
        ...(text(revisionSource, "repaymentMethod") === ""
          ? {}
          : { repaymentMethod: text(revisionSource, "repaymentMethod") }),
        ...(typeof revisionSource.annualInterestRate === "number"
          ? { annualInterestRate: revisionSource.annualInterestRate }
          : {}),
        schemaVersion: 1,
        createdAt: timestamps.createdAt,
      };
      drafts.push(
        candidateDraft(snapshot, {
          targetPath: `${input.householdPath}/assetAutomationPlanRevisions/${revisionId}`,
          targetData: revisionData,
          action: "create",
          amountInWon: positiveInteger(
            revisionSource,
            automationInput.amount,
            "amountInWon",
          ),
          sourceAmountInWon: currentBalance,
          logicalCollection: "asset-automation-revision",
        }),
      );
    }
  }

  return { drafts, unresolved };
}
