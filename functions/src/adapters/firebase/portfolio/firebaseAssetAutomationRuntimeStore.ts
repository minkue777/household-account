import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldPath, FieldValue } from "firebase-admin/firestore";

import type { AssetAutomationRuntimeStorePort } from "../../../contexts/portfolio/automation/application/ports/out/assetAutomationRuntimePorts";
import type {
  AssetAutomationOperation,
  AssetAutomationTargetResult,
  DueAssetAutomationPlan,
} from "../../../contexts/portfolio/automation/domain/model/assetAutomationRuntime";
import { calculateEffectivePaymentDatePolicy } from "../../../contexts/portfolio/automation/domain/policies/effectivePaymentDate";
import { calculateLoanPrincipalPaymentPolicy } from "../../../contexts/portfolio/automation/domain/policies/loanPrincipalPayment";
import {
  nextYearMonth,
  parseYearMonth,
} from "../../../contexts/portfolio/automation/domain/value-objects/yearMonth";
import { normalizeLoanRepaymentMethod } from "../../../contexts/portfolio/core/public";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";

const PLAN_COLLECTION = "assetAutomationPlans";
const COMPLETE_CURSOR_VERSION = 1;

interface PlanCursor {
  readonly v: typeof COMPLETE_CURSOR_VERSION;
  readonly nextDueDate: string;
  readonly documentPath: string;
}

interface RuntimeRevision {
  readonly revision: number;
  readonly effectiveFromInstant: string;
  readonly effectiveFromMillis: number;
  readonly amountInWon: number;
  readonly configuredDay: number;
  readonly annualInterestRate?: number;
  readonly repaymentMethod?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(
  data: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const value = data?.[field];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function safeVersion(
  data: FirebaseFirestore.DocumentData | undefined,
  field = "aggregateVersion",
): number {
  const value = data?.[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : 1;
}

function timestampIso(value: unknown): string | undefined {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

function seoulDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function operation(value: unknown): AssetAutomationOperation | undefined {
  return value === "savings-contribution" || value === "loan-repayment"
    ? value
    : undefined;
}

function validLocalDate(value: string): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.exec(value);
  if (match === null) return false;
  const candidate = new Date(`${value}T00:00:00.000Z`);
  return (
    candidate.getUTCFullYear() === Number(match[1]) &&
    candidate.getUTCMonth() + 1 === Number(match[2]) &&
    candidate.getUTCDate() === Number(match[3])
  );
}

function encodeCursor(cursor: PlanCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): PlanCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("ASSET_AUTOMATION_CURSOR_INVALID");
  }
  const candidate = record(parsed);
  if (
    candidate?.v !== COMPLETE_CURSOR_VERSION ||
    typeof candidate.nextDueDate !== "string" ||
    candidate.nextDueDate.trim() === "" ||
    typeof candidate.documentPath !== "string" ||
    !/^households\/[^/]+\/assetAutomationPlans\/[^/]+$/u.test(
      candidate.documentPath,
    )
  ) {
    throw new Error("ASSET_AUTOMATION_CURSOR_INVALID");
  }
  return candidate as unknown as PlanCursor;
}

function duePlan(
  snapshot: firestore.QueryDocumentSnapshot,
): DueAssetAutomationPlan | undefined {
  const household = snapshot.ref.parent.parent;
  if (
    household === null ||
    household.parent.id !== "households" ||
    snapshot.ref.parent.id !== PLAN_COLLECTION
  ) {
    return undefined;
  }
  const data = snapshot.data();
  const nextDueDate = text(data, "nextDueDate");
  if (nextDueDate === undefined) return undefined;
  const assetId = text(data, "assetId");
  const parsedOperation = operation(data.operation);
  return {
    householdId: household.id,
    planId: snapshot.id,
    ...(assetId === undefined ? {} : { assetId }),
    ...(parsedOperation === undefined ? {} : { operation: parsedOperation }),
    nextDueDate,
    documentPath: snapshot.ref.path,
  };
}

function runtimeRevision(
  snapshot: firestore.QueryDocumentSnapshot,
): RuntimeRevision | undefined {
  const data = snapshot.data();
  const revision = data.revision;
  const amountInWon = data.amountInWon;
  const configuredDay = data.configuredDay;
  const explicitMonth = text(data, "effectiveFromMonth");
  const instant = timestampIso(data.effectiveFrom ?? data.createdAt);
  const effectiveFromInstant =
    explicitMonth !== undefined && parseYearMonth(explicitMonth) !== undefined
      ? `${explicitMonth}-01T00:00:00+09:00`
      : instant;
  const effectiveFromMillis =
    effectiveFromInstant === undefined
      ? Number.NaN
      : Date.parse(effectiveFromInstant);
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof amountInWon !== "number" ||
    !Number.isSafeInteger(amountInWon) ||
    amountInWon <= 0 ||
    typeof configuredDay !== "number" ||
    !Number.isSafeInteger(configuredDay) ||
    configuredDay < 1 ||
    configuredDay > 31 ||
    effectiveFromInstant === undefined ||
    !Number.isFinite(effectiveFromMillis)
  ) {
    return undefined;
  }
  const interest = data.annualInterestRate;
  return {
    revision,
    effectiveFromInstant,
    effectiveFromMillis,
    amountInWon,
    configuredDay,
    ...(typeof interest === "number" && Number.isFinite(interest)
      ? { annualInterestRate: interest }
      : {}),
    ...(text(data, "repaymentMethod") === undefined
      ? {}
      : { repaymentMethod: text(data, "repaymentMethod") }),
  };
}

function effectiveRevision(
  revisions: readonly RuntimeRevision[],
  targetMonth: string,
  initialActivation?: {
    readonly firstApplicableMonth?: string;
    readonly activationMonthDisposition?: string;
  },
  checkpointDate?: string,
): { readonly revision: RuntimeRevision; readonly effectiveDate: string } | undefined {
  return revisions
    .flatMap((revision) => {
      const calculated = calculateEffectivePaymentDatePolicy(
        targetMonth,
        revision.configuredDay,
      );
      if (calculated.kind !== "success") return [];
      const revisionBoundary = checkpointDate ?? calculated.effectiveDate;
      const dueInstant = localMidnightMillis(revisionBoundary);
      const initialActivationOnDueDate =
        revision.revision === 1 &&
        initialActivation?.firstApplicableMonth === targetMonth &&
        initialActivation.activationMonthDisposition === "applicable" &&
        seoulDate(revision.effectiveFromInstant) === revisionBoundary;
      return revision.effectiveFromMillis <= dueInstant || initialActivationOnDueDate
        ? [{ revision, effectiveDate: calculated.effectiveDate }]
        : [];
    })
    .sort(
      (left, right) =>
        right.revision.effectiveFromMillis - left.revision.effectiveFromMillis ||
        right.revision.revision - left.revision.revision,
    )[0];
}

function executionTargetId(plan: DueAssetAutomationPlan): string {
  return `${plan.documentPath}:${plan.nextDueDate.slice(0, 7)}`;
}

function localMidnightMillis(value: string): number {
  return Date.parse(`${value}T00:00:00+09:00`);
}

export class FirebaseAssetAutomationRuntimeStore
  implements AssetAutomationRuntimeStorePort
{
  constructor(private readonly database: firestore.Firestore) {}

  async listDuePlans(input: {
    readonly asOfDate: string;
    readonly cursor?: string;
    readonly limit: number;
  }) {
    if (!validLocalDate(input.asOfDate)) {
      throw new Error("INVALID_AUTOMATION_AS_OF_DATE");
    }
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
      throw new Error("INVALID_AUTOMATION_PAGE_SIZE");
    }
    let query: firestore.Query = this.database
      .collectionGroup(PLAN_COLLECTION)
      .where("status", "in", ["active", "recovering-before-stop"])
      .where("nextDueDate", "<=", input.asOfDate)
      .orderBy("nextDueDate", "asc")
      .orderBy(FieldPath.documentId(), "asc");
    if (input.cursor !== undefined) {
      const cursor = decodeCursor(input.cursor);
      query = query.startAfter(
        cursor.nextDueDate,
        this.database.doc(cursor.documentPath),
      );
    }
    const snapshot = await query.limit(input.limit).get();
    const plans = snapshot.docs.flatMap((document) => {
      const mapped = duePlan(document);
      return mapped === undefined ? [] : [mapped];
    });
    const last = snapshot.docs.at(-1);
    return {
      plans,
      ...(last === undefined
        ? {}
        : {
            nextCursor: encodeCursor({
              v: COMPLETE_CURSOR_VERSION,
              nextDueDate: text(last.data(), "nextDueDate")!,
              documentPath: last.ref.path,
            }),
          }),
    };
  }

  async applyNextDue(input: {
    readonly plan: DueAssetAutomationPlan;
    readonly asOfDate: string;
    readonly occurrenceId: string;
    readonly processedAt: string;
  }): Promise<AssetAutomationTargetResult> {
    if (
      !validLocalDate(input.asOfDate) ||
      !Number.isFinite(Date.parse(input.processedAt)) ||
      input.plan.documentPath !==
        `households/${input.plan.householdId}/${PLAN_COLLECTION}/${input.plan.planId}`
    ) {
      return {
        kind: "needs-attention",
        targetId: executionTargetId(input.plan),
        code: "AUTOMATION_TARGET_INVALID",
      };
    }
    const planReference = this.database.doc(input.plan.documentPath);
    if (!validLocalDate(input.plan.nextDueDate)) {
      try {
        await this.database.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(planReference);
          if (snapshot.exists) {
            transaction.update(planReference, {
              status: "needs-attention",
              attentionCode: "INVALID_TARGET_MONTH",
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        });
      } catch {
        return {
          kind: "retryable-failure",
          targetId: executionTargetId(input.plan),
          code: "AUTOMATION_UOW_COMMIT_FAILED",
        };
      }
      return {
        kind: "needs-attention",
        targetId: executionTargetId(input.plan),
        code: "INVALID_TARGET_MONTH",
      };
    }
    const household = planReference.parent.parent!;
    const targetMonth = input.plan.nextDueDate.slice(0, 7);

    try {
      return await this.database.runTransaction(async (transaction) => {
        const planSnapshot = await transaction.get(planReference);
        if (!planSnapshot.exists) {
          return {
            kind: "skipped",
            targetId: executionTargetId(input.plan),
            code: "PLAN_NOT_RUNNABLE",
          } as const;
        }
        const planData = planSnapshot.data()!;
        const assetId = text(planData, "assetId");
        const parsedOperation = operation(planData.operation);
        if (assetId === undefined || parsedOperation === undefined) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "AUTOMATION_PLAN_IDENTITY_INVALID",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionTargetId(input.plan),
            code: "AUTOMATION_PLAN_IDENTITY_INVALID",
          } as const;
        }
        if (
          (input.plan.assetId !== undefined && input.plan.assetId !== assetId) ||
          (input.plan.operation !== undefined &&
            input.plan.operation !== parsedOperation)
        ) {
          return {
            kind: "retryable-failure",
            targetId: executionTargetId(input.plan),
            code: "AUTOMATION_PLAN_CHANGED",
          } as const;
        }

        const executionKey = `${input.plan.householdId}:${assetId}:${parsedOperation}:${targetMonth}`;
        const executionHash = hash(executionKey);
        const executionReference = household
          .collection("assetAutomationExecutions")
          .doc(executionHash);
        const receiptReference = household
          .collection("assetAutomationExecutionReceipts")
          .doc(executionHash);
        const canonicalAssetReference = household.collection("assets").doc(assetId);
        const legacyAssetReference = this.database.collection("assets").doc(assetId);
        const revisionsQuery = household
          .collection("assetAutomationPlanRevisions")
          .where("planId", "==", input.plan.planId);
        const [
          executionSnapshot,
          receiptSnapshot,
          canonicalAssetSnapshot,
          legacyAssetSnapshot,
          revisionSnapshot,
        ] = await Promise.all([
          transaction.get(executionReference),
          transaction.get(receiptReference),
          transaction.get(canonicalAssetReference),
          transaction.get(legacyAssetReference),
          transaction.get(revisionsQuery),
        ]);

        if (executionSnapshot.exists) {
          return {
            kind: "already-processed",
            executionKey,
            executionId:
              text(executionSnapshot.data(), "executionId") ??
              `automation-execution-${executionHash}`,
            assetId,
            operation: parsedOperation,
            targetMonth,
            nextDueDate:
              text(planData, "nextDueDate") ?? input.plan.nextDueDate,
          } as const;
        }
        if (receiptSnapshot.exists) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "AUTOMATION_RECEIPT_WITHOUT_EXECUTION",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionTargetId(input.plan),
            code: "AUTOMATION_RECEIPT_WITHOUT_EXECUTION",
          } as const;
        }

        const status = text(planData, "status");
        const currentDue = text(planData, "nextDueDate");
        if (
          (status !== "active" && status !== "recovering-before-stop") ||
          currentDue !== input.plan.nextDueDate ||
          currentDue > input.asOfDate
        ) {
          return {
            kind: "skipped",
            targetId: executionKey,
            code: currentDue !== input.plan.nextDueDate || currentDue > input.asOfDate
              ? "PLAN_NOT_DUE"
              : "PLAN_NOT_RUNNABLE",
          } as const;
        }

        const stopEffectiveAt = timestampIso(planData.stopEffectiveAt);
        if (
          status === "recovering-before-stop" &&
          stopEffectiveAt !== undefined &&
          localMidnightMillis(input.plan.nextDueDate) >= Date.parse(stopEffectiveAt)
        ) {
          transaction.update(planReference, {
            status: text(planData, "statusAfterRecovery") ?? "suspended",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "skipped",
            targetId: executionKey,
            code: "PLAN_NOT_RUNNABLE",
          } as const;
        }

        const canonicalAssetData = canonicalAssetSnapshot.data();
        const legacyAssetData = legacyAssetSnapshot.data();
        const assetData = { ...(legacyAssetData ?? {}), ...(canonicalAssetData ?? {}) };
        const lifecycle =
          text(canonicalAssetData, "lifecycleState") ??
          (legacyAssetData?.isActive === false ? "deleted" : "active");
        if (
          (!canonicalAssetSnapshot.exists && !legacyAssetSnapshot.exists) ||
          text(assetData, "householdId") !== input.plan.householdId ||
          lifecycle !== "active"
        ) {
          return {
            kind: "skipped",
            targetId: executionKey,
            code: "ASSET_NOT_ACTIVE",
          } as const;
        }
        const assetType = text(assetData, "type");
        if (
          (parsedOperation === "savings-contribution" &&
            (assetType !== "savings" ||
              !["installment", "적금"].includes(text(assetData, "subType") ?? ""))) ||
          (parsedOperation === "loan-repayment" && assetType !== "loan")
        ) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "PLAN_ASSET_TYPE_MISMATCH",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionKey,
            code: "PLAN_ASSET_TYPE_MISMATCH",
          } as const;
        }

        const rawBalance = assetData.currentBalance;
        if (typeof rawBalance !== "number" || !Number.isFinite(rawBalance)) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "INVALID_ASSET_BALANCE",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionKey,
            code: "INVALID_ASSET_BALANCE",
          } as const;
        }
        const currentBalance = Math.max(0, Math.round(Math.abs(rawBalance)));
        if (revisionSnapshot.empty) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "AUTOMATION_REVISION_NOT_FOUND",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionKey,
            code: "AUTOMATION_REVISION_NOT_FOUND",
          } as const;
        }
        const mappedRevisions = revisionSnapshot.docs.map((document) => ({
          data: document.data(),
          value: runtimeRevision(document),
        }));
        const revisions = mappedRevisions.flatMap(({ value }) =>
          value === undefined ? [] : [value],
        );
        const currentRevision = planData.currentRevision;
        const revisionNumbers = revisions.map(({ revision }) => revision);
        const revisionSet = new Set(revisionNumbers);
        const revisionIdentityInvalid = mappedRevisions.some(({ data }) =>
          text(data, "householdId") !== input.plan.householdId ||
          text(data, "assetId") !== assetId ||
          operation(data.operation) !== parsedOperation,
        );
        if (
          mappedRevisions.some(({ value }) => value === undefined) ||
          revisionSet.size !== revisionNumbers.length ||
          typeof currentRevision !== "number" ||
          !Number.isSafeInteger(currentRevision) ||
          currentRevision < 1 ||
          !revisionSet.has(currentRevision) ||
          revisionIdentityInvalid
        ) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "AUTOMATION_REVISION_INVALID",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionKey,
            code: "AUTOMATION_REVISION_INVALID",
          } as const;
        }
        const activation = {
          firstApplicableMonth: text(planData, "firstApplicableMonth"),
          activationMonthDisposition: text(
            planData,
            "activationMonthDisposition",
          ),
        };
        const selected = effectiveRevision(
          revisions,
          targetMonth,
          activation,
          input.plan.nextDueDate,
        );
        if (selected === undefined || selected.effectiveDate !== input.plan.nextDueDate) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode:
              selected === undefined
                ? "AUTOMATION_REVISION_NOT_FOUND"
                : "AUTOMATION_NEXT_DUE_DATE_MISMATCH",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionKey,
            code:
              selected === undefined
                ? "AUTOMATION_REVISION_NOT_FOUND"
                : "AUTOMATION_NEXT_DUE_DATE_MISMATCH",
          } as const;
        }

        let appliedAmount = selected.revision.amountInWon;
        let resultingBalance = currentBalance + appliedAmount;
        if (parsedOperation === "loan-repayment") {
          const method = normalizeLoanRepaymentMethod(
            selected.revision.repaymentMethod ?? "",
          );
          if (method === "bullet") {
            return {
              kind: "skipped",
              targetId: executionKey,
              code: "UNSUPPORTED_LOAN_REPAYMENT_METHOD",
            } as const;
          }
          if (
            method !== "equal-principal" &&
            method !== "equal-principal-and-interest"
          ) {
            transaction.update(planReference, {
              status: "needs-attention",
              attentionCode: "UNSUPPORTED_LOAN_REPAYMENT_METHOD",
              updatedAt: FieldValue.serverTimestamp(),
            });
            return {
              kind: "needs-attention",
              targetId: executionKey,
              code: "UNSUPPORTED_LOAN_REPAYMENT_METHOD",
            } as const;
          }
          const repayment = calculateLoanPrincipalPaymentPolicy({
            balance: currentBalance,
            annualInterestRate: selected.revision.annualInterestRate ?? Number.NaN,
            monthlyPayment: selected.revision.amountInWon,
            method,
          });
          if (repayment.kind === "validation-error") {
            transaction.update(planReference, {
              status: "needs-attention",
              attentionCode: repayment.code,
              updatedAt: FieldValue.serverTimestamp(),
            });
            return {
              kind: "needs-attention",
              targetId: executionKey,
              code: repayment.code,
            } as const;
          }
          if (repayment.kind === "unsupported-method") {
            return {
              kind: "skipped",
              targetId: executionKey,
              code: "UNSUPPORTED_LOAN_REPAYMENT_METHOD",
            } as const;
          }
          appliedAmount = repayment.principal;
          resultingBalance = repayment.resultingBalance;
        }

        const parsedTargetMonth = parseYearMonth(targetMonth)!;
        const followingMonth = nextYearMonth(parsedTargetMonth);
        const nextRevision = effectiveRevision(revisions, followingMonth, activation);
        if (nextRevision === undefined) {
          transaction.update(planReference, {
            status: "needs-attention",
            attentionCode: "AUTOMATION_REVISION_NOT_FOUND",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return {
            kind: "needs-attention",
            targetId: executionKey,
            code: "AUTOMATION_REVISION_NOT_FOUND",
          } as const;
        }
        const nextDueDate = nextRevision.effectiveDate;
        const planVersion = safeVersion(planData) + 1;
        const assetVersion = safeVersion(assetData) + 1;
        const executionId = `automation-execution-${executionHash}`;
        const balanceDelta = resultingBalance - currentBalance;
        const finalStatus =
          status === "recovering-before-stop" &&
          stopEffectiveAt !== undefined &&
          localMidnightMillis(nextDueDate) >= Date.parse(stopEffectiveAt)
            ? text(planData, "statusAfterRecovery") ?? "suspended"
            : status;
        const lastMonthField =
          parsedOperation === "savings-contribution"
            ? "lastAutoContributionMonth"
            : "lastAutoRepaymentMonth";
        const canonicalAutomation = record(canonicalAssetData?.automation) ?? {};

        transaction.set(
          canonicalAssetReference,
          {
            ...(!canonicalAssetSnapshot.exists ? assetData : {}),
            assetId,
            householdId: input.plan.householdId,
            lifecycleState: "active",
            currentBalance: resultingBalance,
            aggregateVersion: assetVersion,
            automation: {
              ...canonicalAutomation,
              [lastMonthField]: targetMonth,
            },
            [lastMonthField]: targetMonth,
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp(),
            ...(!canonicalAssetSnapshot.exists
              ? { createdAt: FieldValue.serverTimestamp() }
              : {}),
          },
          { merge: true },
        );
        transaction.set(
          legacyAssetReference,
          {
            ...(!legacyAssetSnapshot.exists ? assetData : {}),
            householdId: input.plan.householdId,
            currentBalance: resultingBalance,
            aggregateVersion: assetVersion,
            isActive: true,
            [lastMonthField]: targetMonth,
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp(),
            ...(!legacyAssetSnapshot.exists
              ? { createdAt: FieldValue.serverTimestamp() }
              : {}),
          },
          { merge: true },
        );
        transaction.update(planReference, {
          nextDueDate,
          lastAppliedMonth: targetMonth,
          status: finalStatus,
          aggregateVersion: planVersion,
          lastExecutionKey: executionKey,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(executionReference, {
          executionId,
          executionKey,
          occurrenceId: input.occurrenceId,
          householdId: input.plan.householdId,
          planId: input.plan.planId,
          assetId,
          operation: parsedOperation,
          targetMonth,
          effectiveDate: selected.effectiveDate,
          appliedRevision: selected.revision.revision,
          appliedAmountInWon: appliedAmount,
          balanceDeltaInWon: balanceDelta,
          resultingBalanceInWon: resultingBalance,
          resultingAssetVersion: assetVersion,
          status: "applied",
          processedAt: input.processedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.create(receiptReference, {
          receiptId: executionHash,
          executionId,
          executionKey,
          occurrenceId: input.occurrenceId,
          householdId: input.plan.householdId,
          resultingAssetVersion: assetVersion,
          status: "completed",
          terminalAt: input.processedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });

        const outbox = new FirebaseTransactionalOutbox(this.database);
        outbox.append(transaction, {
          eventId: hash(`${executionKey}\u0000AssetAutomationApplied.v1`),
          eventType: "AssetAutomationApplied.v1",
          householdId: input.plan.householdId,
          aggregateId: input.plan.planId,
          aggregateVersion: planVersion,
          occurredAt: input.processedAt,
          correlationId: input.occurrenceId,
          causationId: executionKey,
          payload: {
            assetId,
            operation: parsedOperation,
            targetMonth,
            effectiveDate: selected.effectiveDate,
            appliedAmount,
            executionId,
            resultingAssetVersion: assetVersion,
          },
        });
        outbox.append(transaction, {
          eventId: hash(`${executionKey}\u0000AssetValuationChanged.v1`),
          eventType: "AssetValuationChanged.v1",
          householdId: input.plan.householdId,
          aggregateId: assetId,
          aggregateVersion: assetVersion,
          occurredAt: input.processedAt,
          correlationId: input.occurrenceId,
          causationId: executionKey,
          payload: {
            assetId,
            assetType,
            lifecycleState: "active",
            previousSignedBalance:
              assetType === "loan" ? -Math.abs(currentBalance) : currentBalance,
            currentSignedBalance:
              assetType === "loan"
                ? -Math.abs(resultingBalance)
                : resultingBalance,
            valuationAsOf: input.processedAt,
            reason: "automation",
          },
        });

        return {
          kind: "applied",
          executionKey,
          executionId,
          assetId,
          operation: parsedOperation,
          targetMonth,
          nextDueDate,
        } as const;
      });
    } catch {
      return {
        kind: "retryable-failure",
        targetId: executionTargetId(input.plan),
        code: "AUTOMATION_UOW_COMMIT_FAILED",
      };
    }
  }
}
