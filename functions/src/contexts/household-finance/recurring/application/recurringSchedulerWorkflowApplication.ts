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

interface DueTask {
  householdId: string;
  planId: string;
  targetMonth?: string;
  noDataReason?: "INACTIVE_PLAN" | "NON_POSITIVE_PLAN_AMOUNT";
}

function checkpoint(asOfDate: string, index: number): string {
  return `recurring:${asOfDate}:${index}`;
}

function checkpointIndex(value: string | undefined, asOfDate: string): number {
  if (value === undefined) return 0;
  const prefix = `recurring:${asOfDate}:`;
  if (!value.startsWith(prefix)) return -1;
  const parsed = Number(value.slice(prefix.length));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
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
      const state = await dependencies.unitOfWork.read();
      const tasks: DueTask[] = [];
      for (const plan of state.plans) {
        if (!plan.active) {
          tasks.push({
            householdId: plan.householdId,
            planId: plan.planId,
            noDataReason: "INACTIVE_PLAN",
          });
          continue;
        }
        if (!Number.isSafeInteger(plan.amountInWon) || plan.amountInWon <= 0) {
          tasks.push({
            householdId: plan.householdId,
            planId: plan.planId,
            noDataReason: "NON_POSITIVE_PLAN_AMOUNT",
          });
          continue;
        }
        const due = findDueRecurringMonths({
          plan: {
            planId: plan.planId,
            createdOn: `${plan.firstApplicableMonth}-01`,
            requestedDay: plan.dayOfMonth,
            firstApplicableMonth: plan.firstApplicableMonth,
            active: true,
          },
          asOfDate: input.asOfDate,
          completedMonths: [],
          limit: 10_000,
        });
        if (due.kind !== "success") {
          return { kind: "validation-error", code: due.code };
        }
        tasks.push(
          ...due.months.map((targetMonth) => ({
            householdId: plan.householdId,
            planId: plan.planId,
            targetMonth,
          })),
        );
      }

      const start = checkpointIndex(input.checkpoint, input.asOfDate);
      if (start < 0 || start > tasks.length) {
        return { kind: "validation-error", code: "INVALID_CHECKPOINT" };
      }
      const end = Math.min(start + input.limit, tasks.length);
      const results = [];
      for (let index = start; index < end; index += 1) {
        const task = tasks[index]!;
        if (task.noDataReason !== undefined) {
          results.push({
            kind: "no-data" as const,
            planId: task.planId,
            reason: task.noDataReason,
          });
          continue;
        }
        const result = await processTarget({
          householdId: task.householdId,
          planId: task.planId,
          targetMonth: task.targetMonth!,
          asOfDate: input.asOfDate,
        });
        if (result.kind === "retryable-failure") {
          results.push({
            ...result,
            code: "RECURRING_TARGET_PROCESS_FAILED",
          });
          return {
            kind: "partial-failure",
            results,
            retryFromCheckpoint: checkpoint(input.asOfDate, index),
            completed: false,
          };
        }
        results.push(result);
      }
      const completed = end >= tasks.length;
      return {
        kind: "success",
        results,
        ...(completed
          ? {}
          : { nextCheckpoint: checkpoint(input.asOfDate, end) }),
        completed,
      };
    },
  };
}
