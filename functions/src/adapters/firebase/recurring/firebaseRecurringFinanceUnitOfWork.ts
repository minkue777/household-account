import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { RecurringFinanceUnitOfWork } from "../../../contexts/household-finance/recurring/application/ports/out/recurringProcessingPorts";
import type {
  RecurringExecution,
  RecurringLedgerTransaction,
  RecurringProcessPlan,
  RecurringProcessReceipt,
  RecurringProcessingDecision,
  RecurringProcessingState,
} from "../../../contexts/household-finance/recurring/domain/model/recurringProcessing";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  snapshot: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot,
): RecurringProcessPlan | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const householdId = text(data, "householdId");
  const merchant = text(data, "merchant");
  const categoryId = text(data, "categoryId", "category");
  const creatorMemberId = text(data, "creatorMemberId", "createdBy");
  const firstApplicableMonth = text(data, "firstApplicableMonth");
  if (
    householdId === undefined ||
    merchant === undefined ||
    categoryId === undefined ||
    creatorMemberId === undefined ||
    firstApplicableMonth === undefined ||
    data?.lifecycleState === "deleted" ||
    data?.deletedAt !== undefined
  ) {
    return undefined;
  }
  return {
    householdId,
    planId: text(data, "planId") ?? snapshot.id,
    merchant,
    amountInWon: numberValue(data, 0, "amountInWon", "amount"),
    categoryId,
    dayOfMonth: numberValue(data, 1, "dayOfMonth"),
    memo: text(data, "memo") ?? "",
    active: data?.active === false || data?.isActive === false ? false : true,
    creatorMemberId,
    firstApplicableMonth,
    version: Math.max(1, numberValue(data, 1, "version", "aggregateVersion")),
  };
}

function mapExecution(
  snapshot: firestore.DocumentSnapshot,
): RecurringExecution | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const executionKey = text(data, "executionKey");
  const planId = text(data, "planId");
  const targetMonth = text(data, "targetMonth");
  const effectiveDate = text(data, "effectiveDate");
  const ledgerTransactionId = text(data, "ledgerTransactionId");
  const processedAt = text(data, "processedAt");
  return executionKey !== undefined &&
    planId !== undefined &&
    targetMonth !== undefined &&
    effectiveDate !== undefined &&
    ledgerTransactionId !== undefined &&
    processedAt !== undefined
    ? {
        executionKey,
        planId,
        targetMonth,
        effectiveDate,
        status: "completed",
        ledgerTransactionId,
        processedAt,
        version: Math.max(1, numberValue(data, 1, "version")),
      }
    : undefined;
}

function mapReceipt(
  snapshot: firestore.DocumentSnapshot,
): RecurringProcessReceipt | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  const idempotencyKey = text(data, "idempotencyKey");
  const payloadSignature = text(data, "payloadSignature");
  const ledgerTransactionId = text(data, "ledgerTransactionId");
  return idempotencyKey !== undefined &&
    payloadSignature !== undefined &&
    ledgerTransactionId !== undefined
    ? { idempotencyKey, payloadSignature, ledgerTransactionId }
    : undefined;
}

function emptyState(plans: readonly RecurringProcessPlan[] = []): RecurringProcessingState {
  return {
    plans,
    executions: [],
    ledgerTransactions: [],
    receipts: [],
    outboxEvents: [],
  };
}

function executionParts(executionKey: string):
  | { planId: string; targetMonth: string }
  | undefined {
  const match = /^(.*):(\d{4}-\d{2})$/u.exec(executionKey);
  return match === null || match[1] === ""
    ? undefined
    : { planId: match[1], targetMonth: match[2] };
}

interface PlanLocation {
  readonly householdId: string;
  readonly planId: string;
}

export class FirebaseRecurringFinanceUnitOfWork
  implements RecurringFinanceUnitOfWork
{
  constructor(private readonly database: firestore.Firestore) {}

  private async locatePlan(planId: string): Promise<PlanLocation | undefined> {
    const legacy = await this.database.collection("recurring_expenses").doc(planId).get();
    const legacyHouseholdId = text(legacy.data(), "householdId");
    if (legacyHouseholdId !== undefined) {
      return { householdId: legacyHouseholdId, planId };
    }
    const canonical = await this.database
      .collectionGroup("recurringPlans")
      .where("planId", "==", planId)
      .limit(2)
      .get();
    if (canonical.size !== 1) return undefined;
    const householdId = text(canonical.docs[0].data(), "householdId");
    return householdId === undefined ? undefined : { householdId, planId };
  }

  async read(): Promise<RecurringProcessingState> {
    const [canonical, legacy] = await Promise.all([
      this.database.collectionGroup("recurringPlans").get(),
      this.database.collection("recurring_expenses").get(),
    ]);
    const plans = new Map<string, RecurringProcessPlan>();
    for (const snapshot of legacy.docs) {
      const plan = mapPlan(snapshot);
      if (plan !== undefined) plans.set(`${plan.householdId}\u0000${plan.planId}`, plan);
    }
    for (const snapshot of canonical.docs) {
      const plan = mapPlan(snapshot);
      if (plan !== undefined) plans.set(`${plan.householdId}\u0000${plan.planId}`, plan);
    }
    return emptyState([...plans.values()]);
  }

  async transact(
    executionKey: string,
    decide: (state: RecurringProcessingState) => RecurringProcessingDecision,
  ) {
    const parts = executionParts(executionKey);
    if (parts === undefined) {
      return {
        result: {
          kind: "retryable-failure" as const,
          planId: executionKey,
          targetMonth: "",
          code: "INVALID_RECURRING_EXECUTION_KEY",
        },
        committedEvents: [],
      };
    }
    let location: PlanLocation | undefined;
    try {
      location = await this.locatePlan(parts.planId);
    } catch {
      return {
        result: {
          kind: "retryable-failure" as const,
          planId: parts.planId,
          targetMonth: parts.targetMonth,
          code: "RECURRING_PLAN_LOOKUP_FAILED",
        },
        committedEvents: [],
      };
    }
    if (location === undefined) {
      const decision = decide(emptyState());
      return {
        result: decision.result,
        committedEvents: [],
      };
    }
    const household = this.database.collection("households").doc(location.householdId);
    const canonicalPlan = household.collection("recurringPlans").doc(location.planId);
    const legacyPlan = this.database.collection("recurring_expenses").doc(location.planId);
    const execution = household
      .collection("recurringExecutions")
      .doc(hash(executionKey));
    const receipt = household
      .collection("recurringExecutionReceipts")
      .doc(hash(executionKey));

    try {
      return await this.database.runTransaction(async (transaction) => {
        const [canonicalSnapshot, legacySnapshot, executionSnapshot, receiptSnapshot] =
          await Promise.all([
            transaction.get(canonicalPlan),
            transaction.get(legacyPlan),
            transaction.get(execution),
            transaction.get(receipt),
          ]);
        const plan = mapPlan(canonicalSnapshot) ?? mapPlan(legacySnapshot);
        const priorExecution = mapExecution(executionSnapshot);
        const priorReceipt = mapReceipt(receiptSnapshot);
        const state: RecurringProcessingState = {
          ...emptyState(plan === undefined ? [] : [plan]),
          executions: priorExecution === undefined ? [] : [priorExecution],
          receipts: priorReceipt === undefined ? [] : [priorReceipt],
        };
        const decision = decide(state);
        if (decision.kind === "return") {
          return { result: decision.result, committedEvents: [] };
        }
        const createdLedger = decision.nextState.ledgerTransactions.find(
          (value) => value.recurringPlanId === location.planId &&
            value.recurringTargetMonth === parts.targetMonth,
        );
        const createdExecution = decision.nextState.executions.find(
          (value) => value.executionKey === executionKey,
        );
        const createdReceipt = decision.nextState.receipts.find(
          (value) => value.idempotencyKey === executionKey,
        );
        if (
          plan === undefined ||
          createdLedger === undefined ||
          createdExecution === undefined ||
          createdReceipt === undefined
        ) {
          return {
            result: {
              kind: "retryable-failure" as const,
              planId: location.planId,
              targetMonth: parts.targetMonth,
              code: "RECURRING_UOW_DECISION_INCOMPLETE",
            },
            committedEvents: [],
          };
        }
        const canonicalLedger = household
          .collection("ledgerTransactions")
          .doc(createdLedger.transactionId);
        const legacyLedger = this.database
          .collection("expenses")
          .doc(createdLedger.transactionId);
        const [canonicalLedgerSnapshot, legacyLedgerSnapshot] = await Promise.all([
          transaction.get(canonicalLedger),
          transaction.get(legacyLedger),
        ]);
        if (canonicalLedgerSnapshot.exists || legacyLedgerSnapshot.exists) {
          return {
            result: {
              kind: "retryable-failure" as const,
              planId: location.planId,
              targetMonth: parts.targetMonth,
              code: "RECURRING_LEDGER_ID_COLLISION",
            },
            committedEvents: [],
          };
        }
        const ledgerDocument = this.ledgerDocument(
          location.householdId,
          createdLedger,
        );
        transaction.create(canonicalLedger, ledgerDocument);
        transaction.create(legacyLedger, { ...ledgerDocument, schemaVersion: 1 });
        transaction.create(execution, {
          ...createdExecution,
          householdId: location.householdId,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.create(receipt, {
          ...createdReceipt,
          householdId: location.householdId,
          status: "completed",
          terminalAt: createdExecution.processedAt,
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
        });
        const latestMonth = [
          parts.targetMonth,
          text(canonicalSnapshot.data(), "lastProcessedMonth"),
          text(legacySnapshot.data(), "lastRegisteredMonth"),
        ]
          .filter((value): value is string => value !== undefined)
          .sort()
          .at(-1)!;
        transaction.set(
          canonicalPlan,
          {
            householdId: plan.householdId,
            planId: plan.planId,
            merchant: plan.merchant,
            amountInWon: plan.amountInWon,
            categoryId: plan.categoryId,
            dayOfMonth: plan.dayOfMonth,
            memo: plan.memo,
            active: plan.active,
            creatorMemberId: plan.creatorMemberId,
            firstApplicableMonth: plan.firstApplicableMonth,
            lifecycleState: "active",
            version: plan.version,
            aggregateVersion: plan.version,
            lastProcessedMonth: latestMonth,
            lastExecutionKey: executionKey,
            processingCheckpointVersion: FieldValue.increment(1),
            schemaVersion: 2,
            updatedAt: FieldValue.serverTimestamp(),
            ...(canonicalSnapshot.exists
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
        transaction.set(
          legacyPlan,
          {
            householdId: plan.householdId,
            merchant: plan.merchant,
            amount: plan.amountInWon,
            category: plan.categoryId,
            dayOfMonth: plan.dayOfMonth,
            memo: plan.memo,
            isActive: plan.active,
            creatorMemberId: plan.creatorMemberId,
            firstApplicableMonth: plan.firstApplicableMonth,
            lifecycleState: "active",
            aggregateVersion: plan.version,
            lastRegisteredMonth: latestMonth,
            lastExecutionKey: executionKey,
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp(),
            ...(legacySnapshot.exists
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
        const outbox = new FirebaseTransactionalOutbox(this.database);
        for (const event of decision.events) {
          outbox.append(transaction, {
            eventId: event.eventId,
            eventType: event.eventType,
            householdId: location.householdId,
            aggregateId:
              event.eventType === "TransactionRecorded.v1"
                ? event.transactionId
                : executionKey,
            aggregateVersion: 1,
            occurredAt: createdExecution.processedAt,
            correlationId: executionKey,
            causationId: executionKey,
            payload: {
              planId: event.planId,
              targetMonth: event.targetMonth,
              transactionId: event.transactionId,
            },
          });
        }
        return { result: decision.result, committedEvents: decision.events };
      });
    } catch {
      return {
        result: {
          kind: "retryable-failure" as const,
          planId: parts.planId,
          targetMonth: parts.targetMonth,
          code: "RECURRING_UOW_COMMIT_FAILED",
        },
        committedEvents: [],
      };
    }
  }

  private ledgerDocument(
    householdId: string,
    value: RecurringLedgerTransaction,
  ) {
    return {
      householdId,
      transactionType: value.transactionType,
      source: value.source,
      originChannel: value.originChannel,
      creatorMemberId: value.creatorMemberId,
      merchant: value.merchant,
      amountInWon: value.amountInWon,
      amount: value.amountInWon,
      categoryId: value.categoryId,
      category: value.categoryId,
      memo: value.memo,
      accountingDate: value.accountingDate,
      date: value.accountingDate,
      localTime: "00:00",
      time: "00:00",
      cardDisplay: "자동등록",
      cardType: "manual",
      lifecycleState: "active",
      aggregateVersion: 1,
      recurringPlanId: value.recurringPlanId,
      recurringTargetMonth: value.recurringTargetMonth,
      schemaVersion: 2,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }
}
