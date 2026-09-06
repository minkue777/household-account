import { createHash } from "node:crypto";
import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { createRecurringCategoryRemapApplication } from "../../../contexts/household-finance/recurring/application/recurringCategoryRemapApplication";
import type { RecurringCategoryRemapState } from "../../../contexts/household-finance/recurring/domain/model/recurringCategoryRemap";
import { FirebaseTransactionalOutbox } from "../outbox/firebaseTransactionalOutbox";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function createFirebaseRecurringCategoryRemapper(database: firestore.Firestore, householdId: string) {
  return {
    async remapRecurringReferences(request: { processId: string; sourceCategoryId: string; destinationCategoryId: string }): Promise<{ kind: "success" } | { kind: "retryable-failure"; code: string }> {
      let cursor: string | undefined;
      try {
        const household = database.collection("households").doc(householdId);
        const application = createRecurringCategoryRemapApplication({
          hash: { hash },
          unitOfWork: {
            async read() { throw new Error("REMAP_READ_NOT_USED"); },
            async transact(retryCursor, decide) {
              return database.runTransaction(async transaction => {
                const receipt = household.collection("categoryRecurringRemapReceipts").doc(hash(`${request.processId}:${retryCursor ?? "START"}`));
                const [canonical, legacy, prior] = await Promise.all([
                  transaction.get(household.collection("recurringPlans")),
                  transaction.get(database.collection("recurring_expenses").where("householdId", "==", householdId)),
                  transaction.get(receipt),
                ]);
                const documents = new Map(legacy.docs.map(doc => [doc.id, doc.data()]));
                for (const doc of canonical.docs) documents.set(doc.id, doc.data());
                const state: RecurringCategoryRemapState = {
                  plans: [...documents].map(([planId, data]) => ({ planId, categoryId: String(data.categoryId ?? data.category), active: data.active !== false && data.isActive !== false, lifecycleState: data.lifecycleState === "deleted" ? "deleted" : "active", version: Number(data.version ?? data.aggregateVersion ?? 1) })),
                  historicalLedgerTransactions: [], receipts: prior.exists ? [prior.data() as RecurringCategoryRemapState["receipts"][number]] : [], events: [],
                };
                const decision = decide(state);
                if (decision.kind === "return") return decision.result;
                const selected = new Set(decision.selectedPlanIds);
                for (const plan of decision.nextState.plans.filter(item => selected.has(item.planId))) {
                  transaction.set(household.collection("recurringPlans").doc(plan.planId), { ...documents.get(plan.planId), householdId, categoryId: plan.categoryId, version: plan.version, aggregateVersion: plan.version, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
                  transaction.set(database.collection("recurring_expenses").doc(plan.planId), { householdId, category: plan.categoryId, aggregateVersion: plan.version, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
                }
                for (const event of decision.nextState.events) new FirebaseTransactionalOutbox(database).append(transaction, {
                  eventId: hash(`${request.processId}:${event.planId}:${event.planVersion}`), eventType: event.eventType, householdId,
                  aggregateId: event.planId, aggregateVersion: event.planVersion, occurredAt: new Date().toISOString(), correlationId: request.processId, causationId: request.processId, payload: { ...event },
                });
                transaction.create(receipt, { ...decision.nextState.receipts.at(-1) });
                return decision.result;
              });
            },
          },
        });
        do {
          const result = await application.remap({ actor: { kind: "system", capabilities: ["category-reference-remap"] }, processId: request.processId, fromCategoryId: request.sourceCategoryId, toDefaultCategoryId: request.destinationCategoryId, limit: 100, ...(cursor === undefined ? {} : { cursor }) });
          if (result.kind !== "success" && result.kind !== "already-processed") return { kind: "retryable-failure", code: result.code };
          cursor = result.page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        return { kind: "success" };
      } catch { return { kind: "retryable-failure", code: "RECURRING_CATEGORY_REMAP_FAILED" }; }
    },
  };
}
