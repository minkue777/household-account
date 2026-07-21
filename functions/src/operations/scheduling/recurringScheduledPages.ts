import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebaseRecurringFinanceUnitOfWork } from "../../adapters/firebase/recurring/firebaseRecurringFinanceUnitOfWork";
import { createRecurringSchedulerWorkflowApplication } from "../../contexts/household-finance/recurring/application/recurringSchedulerWorkflowApplication";
import type { ProcessRecurringTargetResult } from "../../contexts/household-finance/recurring/application/ports/in/recurringSchedulerWorkflowInputPort";
import type {
  ScheduledFeaturePagePort,
  ScheduledTargetOutcome,
} from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";

const COMPLETE_CHECKPOINT = "recurring:complete";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function targetOutcome(result: ProcessRecurringTargetResult): ScheduledTargetOutcome {
  const targetId = `${result.planId}:${
    result.kind === "no-data"
      ? result.targetMonth ?? result.reason
      : result.targetMonth
  }`;
  if (result.kind === "created") {
    return {
      targetId,
      outcome: { kind: "SUCCEEDED", receipt: result.ledgerTransactionId },
    };
  }
  if (result.kind === "already-processed") {
    return {
      targetId,
      outcome: { kind: "SKIPPED", receipt: result.ledgerTransactionId },
    };
  }
  if (result.kind === "no-data") {
    return {
      targetId,
      outcome: { kind: "SKIPPED", receipt: result.reason },
    };
  }
  return {
    targetId,
    outcome: { kind: "FAILED", code: result.code, retryable: true },
  };
}

export function createRecurringScheduledPages(input: {
  readonly database: firestore.Firestore;
  readonly asOfDate: string;
  readonly processedAt: string;
  readonly pageSize: number;
}): ScheduledFeaturePagePort {
  const application = createRecurringSchedulerWorkflowApplication({
    unitOfWork: new FirebaseRecurringFinanceUnitOfWork(input.database),
    clock: {
      now: () => input.processedAt,
      localDate: () => input.asOfDate,
    },
    ids: {
      transactionId: (executionKey) => `recurring-${hash(executionKey)}`,
      eventId: (executionKey, eventType) =>
        hash(`${executionKey}\u0000${eventType}`),
    },
    // Firebase UoW가 업무 변경과 함께 transactional outbox에 이미 저장합니다.
    events: { async publish() {} },
  });

  return {
    async nextPage(checkpoint) {
      if (checkpoint === COMPLETE_CHECKPOINT) return undefined;
      const result = await application.processDue({
        actor: { kind: "system", capabilities: ["recurring.process"] },
        asOfDate: input.asOfDate,
        householdZoneId: "Asia/Seoul",
        ...(checkpoint === undefined ? {} : { checkpoint }),
        limit: input.pageSize,
      });
      if (result.kind === "validation-error") {
        throw new Error(result.code);
      }
      if (result.kind === "retryable-failure") {
        return {
          ...(checkpoint === undefined ? {} : { checkpointBefore: checkpoint }),
          checkpointAfter: COMPLETE_CHECKPOINT,
          targets: [
            {
              targetId: `recurring-page:${checkpoint ?? "start"}`,
              outcome: {
                kind: "FAILED",
                code: result.code,
                retryable: true,
              },
            },
          ],
        };
      }
      return {
        ...(checkpoint === undefined ? {} : { checkpointBefore: checkpoint }),
        checkpointAfter:
          result.kind === "partial-failure" || result.completed
            ? COMPLETE_CHECKPOINT
            : result.nextCheckpoint,
        terminal: result.kind === "partial-failure" || result.completed,
        targets: result.results.map(targetOutcome),
      };
    },
  };
}
