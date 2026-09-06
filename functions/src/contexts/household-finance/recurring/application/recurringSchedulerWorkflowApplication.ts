import { decideRecurringTarget } from "../domain/policies/recurringProcessingPolicy";
import { findDueRecurringMonths } from "../domain/policies/recurringSchedule";
import type {
  ProcessDueRecurringPlansResult,
  RecurringSchedulerWorkflowInputPort,
} from "./ports/in/recurringSchedulerWorkflowInputPort";
import type {
  RecurringFinanceUnitOfWork,
  RecurringProcessingClock,
  RecurringProcessingEventPublisher,
  RecurringProcessingIds,
} from "./ports/out/recurringProcessingPorts";

interface PageCursor {
  readonly asOfDate: string;
  readonly afterPlanId?: string;
  readonly resumePlanId?: string;
  readonly afterMonth?: string;
}

function checkpoint(cursor: PageCursor): string {
  return `recurring:v2:${encodeURIComponent(JSON.stringify(cursor))}`;
}

function nextMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function createRecurringSchedulerWorkflowApplication(dependencies: {
  unitOfWork: RecurringFinanceUnitOfWork;
  clock: RecurringProcessingClock;
  ids: RecurringProcessingIds;
  events: RecurringProcessingEventPublisher;
}): RecurringSchedulerWorkflowInputPort {
  const processTarget = async (input: {
    householdId: string;
    planId: string;
    targetMonth: string;
    asOfDate: string;
  }) => {
    const executionKey = `${input.planId}:${input.targetMonth}`;
    const outcome = await dependencies.unitOfWork.transact(
      executionKey,
      (state) =>
        decideRecurringTarget({
          state,
          ...input,
          idempotencyKey: executionKey,
          processedAt: dependencies.clock.now(),
          ledgerTransactionId: dependencies.ids.transactionId(executionKey),
          transactionEventId: dependencies.ids.eventId(
            executionKey,
            "TransactionRecorded.v1",
          ),
          processedEventId: dependencies.ids.eventId(
            executionKey,
            "RecurringPlanProcessed.v1",
          ),
        }),
    );
    if (outcome.committedEvents.length > 0) {
      await dependencies.events.publish(outcome.committedEvents);
    }
    return outcome.result;
  };

  return {
    processMonth(input) {
      return processTarget({
        householdId: input.householdId,
        planId: input.planId,
        targetMonth: input.targetMonth,
        asOfDate: dependencies.clock.localDate(),
      });
    },
    async processDue(input): Promise<ProcessDueRecurringPlansResult> {
      if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
        return { kind: "validation-error", code: "INVALID_PAGE_LIMIT" };
      }
      let cursor: PageCursor = { asOfDate: input.asOfDate };
      if (input.checkpoint !== undefined) {
        try {
          if (!input.checkpoint.startsWith("recurring:v2:")) throw new Error();
          cursor = JSON.parse(decodeURIComponent(input.checkpoint.slice("recurring:v2:".length))) as PageCursor;
          if (cursor.asOfDate !== input.asOfDate || (cursor.afterPlanId !== undefined && typeof cursor.afterPlanId !== "string") || (cursor.resumePlanId !== undefined && typeof cursor.resumePlanId !== "string") || (cursor.afterMonth !== undefined && (typeof cursor.afterMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(cursor.afterMonth)))) throw new Error();
        } catch { return { kind: "validation-error", code: "INVALID_CHECKPOINT" }; }
      }
      const readPage = dependencies.unitOfWork.readPlanPage;
      const page = readPage === undefined ? await (async () => {
        const plans = (await dependencies.unitOfWork.read()).plans
          .filter(plan => cursor.afterPlanId === undefined || plan.planId > cursor.afterPlanId)
          .sort((left, right) => left.planId.localeCompare(right.planId));
        return { plans: plans.slice(0, input.limit), ...(plans.length > input.limit ? { nextCursor: plans[input.limit - 1]!.planId } : {}) };
      })() : await readPage.call(dependencies.unitOfWork, { afterPlanId: cursor.afterPlanId, limit: input.limit });
      const results = [];
      let afterPlanId = cursor.afterPlanId;
      for (const plan of page.plans) {
        if (results.length === input.limit) return { kind: "success", results, completed: false, nextCheckpoint: checkpoint({ asOfDate: input.asOfDate, afterPlanId }) };
        if (!plan.active || !Number.isSafeInteger(plan.amountInWon) || plan.amountInWon <= 0) {
          results.push({ kind: "no-data" as const, planId: plan.planId, reason: !plan.active ? "INACTIVE_PLAN" as const : "NON_POSITIVE_PLAN_AMOUNT" as const });
          afterPlanId = plan.planId;
          continue;
        }
        const afterMonth = cursor.resumePlanId === plan.planId ? cursor.afterMonth : undefined;
        const firstApplicableMonth = [plan.firstApplicableMonth,
          ...(plan.processedThroughMonth === undefined ? [] : [nextMonth(plan.processedThroughMonth)]),
          ...(afterMonth === undefined ? [] : [nextMonth(afterMonth)]),
        ].sort().at(-1)!;
        const due = findDueRecurringMonths({
          plan: { planId: plan.planId, createdOn: `${plan.firstApplicableMonth}-01`, requestedDay: plan.dayOfMonth, firstApplicableMonth, active: true },
          asOfDate: input.asOfDate, completedMonths: [], limit: input.limit - results.length + 1,
        });
        if (due.kind !== "success") return { kind: "validation-error", code: due.code };
        let previousMonth = afterMonth;
        for (const targetMonth of due.months) {
          const resume = { asOfDate: input.asOfDate, afterPlanId, resumePlanId: plan.planId, afterMonth: previousMonth };
          if (results.length === input.limit) return { kind: "success", results, completed: false, nextCheckpoint: checkpoint(resume) };
          const result = await processTarget({ householdId: plan.householdId, planId: plan.planId, targetMonth, asOfDate: input.asOfDate });
          if (result.kind === "retryable-failure") return {
            kind: "partial-failure", results: [...results, { ...result, code: "RECURRING_TARGET_PROCESS_FAILED" }],
            retryFromCheckpoint: checkpoint(resume), completed: false,
          };
          results.push(result);
          previousMonth = targetMonth;
        }
        afterPlanId = plan.planId;
      }
      return { kind: "success", results, completed: page.nextCursor === undefined,
        ...(page.nextCursor === undefined ? {} : { nextCheckpoint: checkpoint({ asOfDate: input.asOfDate, afterPlanId: page.nextCursor }) }),
      };
    },
  };
}
