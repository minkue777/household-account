import type * as firestore from "firebase-admin/firestore";

import { FirebaseAssetAutomationRuntimeStore } from "../../adapters/firebase/portfolio/firebaseAssetAutomationRuntimeStore";
import { createAssetAutomationScheduledApplication } from "../../contexts/portfolio/automation/public";
import type { AssetAutomationTargetResult } from "../../contexts/portfolio/automation/public";
import type {
  ScheduledFeaturePagePort,
  ScheduledTargetOutcome,
} from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";

const COMPLETE = "asset-automation:complete";

function outcome(result: AssetAutomationTargetResult): ScheduledTargetOutcome {
  if (result.kind === "applied") {
    return {
      targetId: result.executionKey,
      outcome: { kind: "SUCCEEDED", receipt: result.executionId },
    };
  }
  if (result.kind === "already-processed") {
    return {
      targetId: result.executionKey,
      outcome: { kind: "SKIPPED", receipt: result.executionId },
    };
  }
  if (result.kind === "retryable-failure") {
    return {
      targetId: result.targetId,
      outcome: { kind: "FAILED", code: result.code, retryable: true },
    };
  }
  return {
    targetId: result.targetId,
    // A quarantined or ineligible Plan is a terminal target decision, not a
    // platform outage that should make every Scheduler retry fail again.
    outcome: { kind: "SKIPPED", receipt: result.code },
  };
}

export function createAssetAutomationScheduledPages(input: {
  readonly database: firestore.Firestore;
  readonly occurrenceId: string;
  readonly asOfDate: string;
  readonly processedAt: string;
  readonly pageSize: number;
}): ScheduledFeaturePagePort {
  const application = createAssetAutomationScheduledApplication({
    store: new FirebaseAssetAutomationRuntimeStore(input.database),
  });
  return {
    async nextPage(checkpoint) {
      if (checkpoint === COMPLETE) return undefined;
      const result = await application.processPage({
        occurrenceId: input.occurrenceId,
        asOfDate: input.asOfDate,
        processedAt: input.processedAt,
        ...(checkpoint === undefined ? {} : { cursor: checkpoint }),
        limit: input.pageSize,
      });
      if (result.completed) {
        return {
          ...(checkpoint === undefined ? {} : { checkpointBefore: checkpoint }),
          checkpointAfter: COMPLETE,
          terminal: true,
          targets: result.results.map(outcome),
        };
      }
      if (result.nextCursor === undefined) {
        throw new Error("ASSET_AUTOMATION_CHECKPOINT_MISSING");
      }
      return {
        ...(checkpoint === undefined ? {} : { checkpointBefore: checkpoint }),
        checkpointAfter: result.nextCursor,
        targets: result.results.map(outcome),
      };
    },
  };
}
