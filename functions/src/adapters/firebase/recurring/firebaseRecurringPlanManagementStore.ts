import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { RecurringPlanManagementStorePort } from "../../../contexts/household-finance/recurring/application/ports/out/recurringPlanManagementPorts";
import type {
  CreatorMappedRecurringPlan,
  RecurringPlan,
  RecurringPlanCommandReceipt,
} from "../../../contexts/household-finance/recurring/domain/model/recurringPlan";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

import { categoryCatalogReference, readCategoryCatalogDocument, resolveCatalogCategoryId } from "../categories/categoryCatalogDocument";

const SCHEMA_VERSION = 2;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function iso(value: unknown, fallback: string): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return fallback;
}

function text(
  data: FirebaseFirestore.DocumentData | undefined,
  ...fields: readonly string[]
): string | undefined {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function numberValue(
  data: FirebaseFirestore.DocumentData | undefined,
  fallback: number,
  ...fields: readonly string[]
): number {
  for (const field of fields) {
    const value = data?.[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function mapPlan(
  householdId: string,
  snapshot: firestore.DocumentSnapshot,
  fallbackNow: string,
): RecurringPlan | undefined {
  const data = snapshot.data();
  if (!data) return undefined;
  if (text(data, "householdId") !== householdId) return undefined;
  const merchant = text(data, "merchant");
  const categoryId = text(data, "categoryId", "category");
  if (merchant === undefined || categoryId === undefined) return undefined;
  const createdAt = iso(data.createdAt, fallbackNow);
  const creatorMemberId = text(data, "creatorMemberId", "createdBy");
  return {
    householdId,
    planId: snapshot.id,
    merchant,
    amountInWon: numberValue(data, 0, "amountInWon", "amount"),
    categoryId,
    dayOfMonth: numberValue(data, 1, "dayOfMonth"),
    memo: text(data, "memo") ?? "",
    active: data.active === false || data.isActive === false ? false : true,
    ...(creatorMemberId === undefined ? {} : { creatorMemberId }),
    firstApplicableMonth:
      text(data, "firstApplicableMonth") ?? createdAt.slice(0, 7),
    createdAt,
    updatedAt: iso(data.updatedAt, createdAt),
    lifecycleState:
      data.lifecycleState === "deleted" || data.deletedAt !== undefined
        ? "deleted"
        : "active",
    version: Math.max(1, numberValue(data, 1, "version", "aggregateVersion")),
  };
}

function mapReceipt(
  snapshot: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot,
): RecurringPlanCommandReceipt | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const commandId = text(data, "commandId");
  const payloadSignature = text(data, "payloadSignature");
  const planId = text(data, "planId");
  const resultKind = text(data, "resultKind");
  const plan = data?.plan as CreatorMappedRecurringPlan | undefined;
  return commandId !== undefined &&
    payloadSignature !== undefined &&
    planId !== undefined &&
    (resultKind === "created" || resultKind === "updated" || resultKind === "deleted") &&
    plan !== undefined &&
    typeof plan.creatorMemberId === "string"
    ? { commandId, payloadSignature, planId, resultKind, plan }
    : undefined;
}

export interface FirebaseRecurringPlanManagementStoreInput {
  readonly householdId: string;
  readonly requestedAt: string;
}

export class FirebaseRecurringPlanManagementStore
  implements RecurringPlanManagementStorePort
{
  constructor(
    private readonly database: firestore.Firestore,
    private readonly input: FirebaseRecurringPlanManagementStoreInput,
  ) {}

  private household() {
    return this.database.collection("households").doc(this.input.householdId);
  }

  private receipt(commandId: string) {
    return this.household()
      .collection("recurringCommandReceipts")
      .doc(hash(commandId));
  }

  async readForList() {
    try {
      const plans = await this.database.runTransaction(async transaction => {
        const [canonical, legacy] = await Promise.all([
          transaction.get(this.household().collection("recurringPlans")),
          transaction.get(this.database.collection("recurring_expenses").where("householdId", "==", this.input.householdId)),
        ]);
        const byId = new Map<string, RecurringPlan>();
        for (const doc of [...legacy.docs, ...canonical.docs]) {
          const plan = mapPlan(this.input.householdId, doc, this.input.requestedAt);
          if (plan) byId.set(plan.planId, plan);
        }
        return [...byId.values()];
      });
      return { kind: "success" as const, plans };
    } catch { return { kind: "retryable-failure" as const, code: "RECURRING_PLAN_REPOSITORY_UNAVAILABLE" as const }; }
  }

  async transact<T>(planId: string, commandId: string,
    operation: Parameters<RecurringPlanManagementStorePort["transact"]>[2]): Promise<T> {
    const reference = this.household().collection("recurringPlans").doc(planId);
    const legacyReference = this.database.collection("recurring_expenses").doc(planId);
    const receiptReference = this.receipt(commandId);
    return this.database.runTransaction(async transaction => {
      const [canonical, legacy, receiptDoc] = await transaction.getAll(reference, legacyReference, receiptReference);
      const mutation = await operation({
        plan: mapPlan(this.input.householdId, canonical, this.input.requestedAt)
          ?? mapPlan(this.input.householdId, legacy, this.input.requestedAt),
        receipt: mapReceipt(receiptDoc),
        categoryIsUsable: async categoryId => {
          const snapshot = await transaction.get(categoryCatalogReference(this.database, this.input.householdId));
          const catalog = readCategoryCatalogDocument(snapshot.data(), this.input.householdId);
          const resolved = resolveCatalogCategoryId(catalog, categoryId);
          return catalog.categories.some(category => category.categoryId === resolved && category.state === "active");
        },
      });
      if (!mutation.change) return mutation.value as T;
      if (legacy.exists && legacy.get("householdId") !== this.input.householdId) throw new Error("RECURRING_PLAN_SCOPE_MISMATCH");
      const { plan, receipt, event } = mutation.change;
      transaction.set(reference, {
        householdId: this.input.householdId, planId, merchant: plan.merchant, amountInWon: plan.amountInWon,
        categoryId: plan.categoryId, dayOfMonth: plan.dayOfMonth, memo: plan.memo, active: plan.active,
        creatorMemberId: plan.creatorMemberId, firstApplicableMonth: plan.firstApplicableMonth,
        lifecycleState: plan.lifecycleState, version: plan.version, aggregateVersion: plan.version, schemaVersion: SCHEMA_VERSION,
        updatedAt: Timestamp.fromDate(new Date(plan.updatedAt)),
        ...(canonical.exists ? {} : { createdAt: Timestamp.fromDate(new Date(plan.createdAt)) }),
      }, { merge: true });
      if (plan.lifecycleState === "deleted") transaction.delete(legacyReference);
      else transaction.set(legacyReference, {
        householdId: this.input.householdId, merchant: plan.merchant, amount: plan.amountInWon, category: plan.categoryId,
        dayOfMonth: plan.dayOfMonth, memo: plan.memo, isActive: plan.active, creatorMemberId: plan.creatorMemberId,
        firstApplicableMonth: plan.firstApplicableMonth, lifecycleState: plan.lifecycleState,
        aggregateVersion: plan.version, schemaVersion: 1, updatedAt: Timestamp.fromDate(new Date(plan.updatedAt)),
        ...(legacy.exists ? {} : { createdAt: Timestamp.fromDate(new Date(plan.createdAt)) }),
      }, { merge: true });
      transaction.create(receiptReference, { ...receipt, householdId: this.input.householdId, status: "completed",
        terminalAt: this.input.requestedAt, expiresAt: firestoreTtlAfter(this.input.requestedAt), schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp() });
      new FirebaseTransactionalOutbox(this.database).append(transaction, {
        eventId: hash(`${this.input.householdId}\u0000${event.planId}\u0000${event.planVersion}`),
        eventType: "RecurringPlanChanged.v1", householdId: this.input.householdId, aggregateId: planId,
        aggregateVersion: event.planVersion, occurredAt: this.input.requestedAt,
        correlationId: commandId, causationId: commandId,
        payload: { planId, active: event.active, dayOfMonth: event.dayOfMonth, changeKind: event.changeKind },
      });
      return mutation.value as T;
    });
  }
}
