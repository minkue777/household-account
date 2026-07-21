import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { RecurringPlanManagementStorePort } from "../../../contexts/household-finance/recurring/application/ports/out/recurringPlanManagementPorts";
import type {
  CreatorMappedRecurringPlan,
  RecurringPlan,
  RecurringPlanCommandReceipt,
  RecurringPlanManagementState,
} from "../../../contexts/household-finance/recurring/domain/model/recurringPlan";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

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
  snapshot: firestore.QueryDocumentSnapshot,
  fallbackNow: string,
): RecurringPlan | undefined {
  const data = snapshot.data();
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

function signature(plan: RecurringPlan): string {
  return JSON.stringify([
    plan.merchant,
    plan.amountInWon,
    plan.categoryId,
    plan.dayOfMonth,
    plan.memo,
    plan.active,
    plan.creatorMemberId,
    plan.firstApplicableMonth,
    plan.lifecycleState,
    plan.version,
  ]);
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

  private async load(
    reader: Pick<firestore.Transaction, "get">,
  ): Promise<{
    state: RecurringPlanManagementState;
    canonicalIds: ReadonlySet<string>;
    legacyIds: ReadonlySet<string>;
  }> {
    const [canonical, legacy, receipts] = await Promise.all([
      reader.get(this.household().collection("recurringPlans")),
      reader.get(
        this.database
          .collection("recurring_expenses")
          .where("householdId", "==", this.input.householdId),
      ),
      reader.get(this.household().collection("recurringCommandReceipts")),
    ]);
    const canonicalPlans = canonical.docs.flatMap((snapshot) => {
      const plan = mapPlan(this.input.householdId, snapshot, this.input.requestedAt);
      return plan === undefined ? [] : [plan];
    });
    const canonicalIds = new Set(canonicalPlans.map(({ planId }) => planId));
    const legacyPlans = legacy.docs.flatMap((snapshot) => {
      const plan = mapPlan(this.input.householdId, snapshot, this.input.requestedAt);
      return plan === undefined || canonicalIds.has(plan.planId) ? [] : [plan];
    });
    return {
      state: {
        plans: [...canonicalPlans, ...legacyPlans],
        receipts: receipts.docs.flatMap((snapshot) => {
          const receipt = mapReceipt(snapshot);
          return receipt === undefined ? [] : [receipt];
        }),
        events: [],
      },
      canonicalIds: new Set(canonical.docs.map(({ id }) => id)),
      legacyIds: new Set(legacy.docs.map(({ id }) => id)),
    };
  }

  async read(): Promise<RecurringPlanManagementState> {
    return this.database.runTransaction(async (transaction) =>
      (await this.load(transaction)).state,
    );
  }

  async readReceipt(
    commandId: string,
  ): Promise<RecurringPlanCommandReceipt | undefined> {
    return mapReceipt(await this.receipt(commandId).get());
  }

  async readForList() {
    try {
      return { kind: "success" as const, state: await this.read() };
    } catch {
      return {
        kind: "retryable-failure" as const,
        code: "RECURRING_PLAN_REPOSITORY_UNAVAILABLE" as const,
      };
    }
  }

  async transact<T>(
    operation: Parameters<RecurringPlanManagementStorePort["transact"]>[0],
  ): Promise<T> {
    return this.database.runTransaction(async (transaction) => {
      const loaded = await this.load(transaction);
      const mutation = operation(loaded.state);
      const beforeById = new Map(
        loaded.state.plans.map((plan) => [plan.planId, plan]),
      );
      for (const plan of mutation.state.plans) {
        const before = beforeById.get(plan.planId);
        if (before !== undefined && signature(before) === signature(plan)) continue;
        const common = {
          householdId: this.input.householdId,
          planId: plan.planId,
          merchant: plan.merchant,
          amountInWon: plan.amountInWon,
          categoryId: plan.categoryId,
          dayOfMonth: plan.dayOfMonth,
          memo: plan.memo,
          active: plan.active,
          ...(plan.creatorMemberId === undefined
            ? {}
            : { creatorMemberId: plan.creatorMemberId }),
          firstApplicableMonth: plan.firstApplicableMonth,
          lifecycleState: plan.lifecycleState,
          version: plan.version,
          aggregateVersion: plan.version,
          schemaVersion: SCHEMA_VERSION,
          updatedAt: Timestamp.fromDate(new Date(plan.updatedAt)),
          ...(loaded.canonicalIds.has(plan.planId)
            ? {}
            : { createdAt: Timestamp.fromDate(new Date(plan.createdAt)) }),
        };
        transaction.set(
          this.household().collection("recurringPlans").doc(plan.planId),
          common,
          { merge: true },
        );
        const legacyReference = this.database
          .collection("recurring_expenses")
          .doc(plan.planId);
        if (plan.lifecycleState === "deleted") {
          transaction.delete(legacyReference);
        } else {
          transaction.set(
            legacyReference,
            {
            householdId: this.input.householdId,
            merchant: plan.merchant,
            amount: plan.amountInWon,
            category: plan.categoryId,
            dayOfMonth: plan.dayOfMonth,
            memo: plan.memo,
            isActive: plan.lifecycleState === "active" && plan.active,
            ...(plan.creatorMemberId === undefined
              ? {}
              : { creatorMemberId: plan.creatorMemberId }),
            firstApplicableMonth: plan.firstApplicableMonth,
            lifecycleState: plan.lifecycleState,
            aggregateVersion: plan.version,
            schemaVersion: 1,
            updatedAt: Timestamp.fromDate(new Date(plan.updatedAt)),
            ...(loaded.legacyIds.has(plan.planId)
              ? {}
              : { createdAt: Timestamp.fromDate(new Date(plan.createdAt)) }),
            },
            { merge: true },
          );
        }
      }

      const existingReceipts = new Set(
        loaded.state.receipts.map(({ commandId }) => commandId),
      );
      for (const receipt of mutation.state.receipts) {
        if (existingReceipts.has(receipt.commandId)) continue;
        transaction.create(this.receipt(receipt.commandId), {
          ...receipt,
          householdId: this.input.householdId,
          status: "completed",
          terminalAt: this.input.requestedAt,
          expiresAt: firestoreTtlAfter(this.input.requestedAt),
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      const outbox = new FirebaseTransactionalOutbox(this.database);
      for (const event of mutation.state.events) {
        outbox.append(transaction, {
          eventId: hash(
            `${this.input.householdId}\u0000${event.planId}\u0000${event.planVersion}`,
          ),
          eventType: "RecurringPlanChanged.v1",
          householdId: this.input.householdId,
          aggregateId: event.planId,
          aggregateVersion: event.planVersion,
          occurredAt: this.input.requestedAt,
          correlationId:
            mutation.state.receipts.at(-1)?.commandId ?? event.planId,
          causationId:
            mutation.state.receipts.at(-1)?.commandId ?? event.planId,
          payload: {
            planId: event.planId,
            active: event.active,
            dayOfMonth: event.dayOfMonth,
            changeKind: event.changeKind,
          },
        });
      }
      return mutation.value as T;
    });
  }
}
