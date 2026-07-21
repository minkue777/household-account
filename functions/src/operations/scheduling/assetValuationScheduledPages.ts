import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import {
  FirebaseActivePortfolioHouseholdReader,
  FirebaseAssetSnapshotProjectionSource,
  FirebaseAssetSnapshotProjectionStore,
  type ActivePortfolioHouseholdPage,
} from "../../adapters/firebase/portfolio/firebaseAssetSnapshotProjection";
import { FirebasePortfolioMarketData } from "../../adapters/firebase/portfolio/firebasePortfolioMarketData";
import { FirebasePortfolioProviderHealthStore } from "../../adapters/firebase/portfolio/firebasePortfolioProviderHealthStore";
import { FirebasePortfolioRuntimeStore } from "../../adapters/firebase/portfolio/firebasePortfolioRuntimeStore";
import {
  createAssetSnapshotProjectionApplication,
  type AssetSnapshotProjectionInputPort,
} from "../../contexts/portfolio/core/public";
import { createPortfolioRuntimeApplication } from "../../contexts/portfolio/core/application/portfolioRuntimeApplication";
import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
} from "../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import type {
  ScheduledFeaturePagePort,
  ScheduledTargetOutcome,
} from "../../platform/external-operations/application/ports/out/scheduledJobExecutionPorts";

const REFRESH_PHASE = "asset-valuation:refresh";
const SNAPSHOT_PHASE = "asset-valuation:snapshot";
const COMPLETE = "asset-valuation:complete";

export interface AssetValuationHouseholdPageReader {
  next(afterHouseholdId?: string): Promise<ActivePortfolioHouseholdPage | undefined>;
}

export interface AssetValuationRefreshWorkflow {
  refreshMarketValues(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetClass: "all";
  }): Promise<PortfolioCommandResult>;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function checkpoint(phase: typeof REFRESH_PHASE | typeof SNAPSHOT_PHASE, cursor?: string): string {
  return cursor === undefined
    ? phase
    : `${phase}:${Buffer.from(cursor, "utf8").toString("base64url")}`;
}

function parseCheckpoint(value: string | undefined): {
  readonly phase: typeof REFRESH_PHASE | typeof SNAPSHOT_PHASE;
  readonly cursor?: string;
} {
  if (value === undefined || value === REFRESH_PHASE) {
    return { phase: REFRESH_PHASE };
  }
  if (value === SNAPSHOT_PHASE) return { phase: SNAPSHOT_PHASE };
  for (const phase of [REFRESH_PHASE, SNAPSHOT_PHASE] as const) {
    const prefix = `${phase}:`;
    if (value.startsWith(prefix)) {
      return {
        phase,
        cursor: Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"),
      };
    }
  }
  throw new Error("ASSET_VALUATION_CHECKPOINT_INVALID");
}

function targetId(phase: "refresh" | "snapshot", householdId: string): string {
  return `asset-valuation:${phase}:${hash(householdId)}`;
}

function refreshMetadata(input: {
  readonly householdId: string;
  readonly executionKey: string;
  readonly scheduledFor: string;
}): PortfolioCommandMetadata {
  const commandId = `asset-valuation-${hash(
    `${input.executionKey}\u0000${input.householdId}`,
  )}`;
  return {
    householdId: input.householdId,
    principalUid: "system:asset-valuation-daily",
    actorMemberId: "system",
    commandId,
    idempotencyKey: commandId,
    commandName: "portfolio.refresh-market-values.v1",
    payloadFingerprint: hash(
      `portfolio.refresh-market-values.v1\u0000all\u0000${input.householdId}`,
    ),
    occurredAt: input.scheduledFor,
  };
}

function numericResultValue(
  result: Extract<PortfolioCommandResult, { readonly kind: "success" }>,
  field: string,
): number {
  const value = result.value[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function refreshOutcome(
  householdId: string,
  result: PortfolioCommandResult,
): ScheduledTargetOutcome {
  if (result.kind === "error") {
    return {
      targetId: targetId("refresh", householdId),
      outcome: {
        kind: "FAILED",
        code: result.code,
        retryable: result.retryable === true,
      },
    };
  }
  const refreshed = numericResultValue(result, "refreshedCount");
  const retained = numericResultValue(result, "retainedLastSuccessCount");
  const targets = numericResultValue(result, "targetCount");
  return {
    targetId: targetId("refresh", householdId),
    outcome:
      retained > 0
        ? {
            kind: "SKIPPED",
            receipt: `terminal-retained:${retained}:refreshed:${refreshed}:targets:${targets}`,
          }
        : {
            kind: "SUCCEEDED",
            receipt: `refreshed:${refreshed}:targets:${targets}`,
          },
  };
}

function inactiveOutcome(
  phase: "refresh" | "snapshot",
  householdId: string,
): ScheduledTargetOutcome {
  return {
    targetId: targetId(phase, householdId),
    outcome: { kind: "SKIPPED", receipt: "HOUSEHOLD_NOT_ACTIVE" },
  };
}

export function createAssetValuationScheduledPages(
  input: {
    readonly database: firestore.Firestore;
    readonly executionKey: string;
    readonly scheduledFor: string;
    readonly asOfDate: string;
  },
  overrides: {
    readonly households?: AssetValuationHouseholdPageReader;
    readonly refresh?: AssetValuationRefreshWorkflow;
    readonly snapshots?: AssetSnapshotProjectionInputPort;
  } = {},
): ScheduledFeaturePagePort {
  const portfolioStore = new FirebasePortfolioRuntimeStore(input.database);
  const households =
    overrides.households ?? new FirebaseActivePortfolioHouseholdReader(input.database);
  const refresh =
    overrides.refresh ??
    createPortfolioRuntimeApplication({
      store: portfolioStore,
      marketQuotes: new FirebasePortfolioMarketData(),
      providerHealth: new FirebasePortfolioProviderHealthStore(input.database),
    });
  const snapshots =
    overrides.snapshots ??
    createAssetSnapshotProjectionApplication({
      source: new FirebaseAssetSnapshotProjectionSource(portfolioStore),
      store: new FirebaseAssetSnapshotProjectionStore(input.database),
    });

  return {
    async nextPage(rawCheckpoint) {
      if (rawCheckpoint === COMPLETE) return undefined;
      const current = parseCheckpoint(rawCheckpoint);
      const household = await households.next(current.cursor);

      if (household === undefined) {
        if (current.phase === REFRESH_PHASE) {
          return {
            ...(rawCheckpoint === undefined
              ? {}
              : { checkpointBefore: rawCheckpoint }),
            checkpointAfter: SNAPSHOT_PHASE,
            targets: [
              {
                targetId: "asset-valuation:refresh-phase-complete",
                outcome: { kind: "SUCCEEDED", receipt: "TERMINAL" },
              },
            ],
          };
        }
        return {
          ...(rawCheckpoint === undefined
            ? {}
            : { checkpointBefore: rawCheckpoint }),
          checkpointAfter: COMPLETE,
          terminal: true,
          targets: [
            {
              targetId: "asset-valuation:snapshot-phase-complete",
              outcome: { kind: "SUCCEEDED", receipt: "TERMINAL" },
            },
          ],
        };
      }

      const checkpointAfter = checkpoint(current.phase, household.householdId);
      if (!household.active) {
        return {
          ...(rawCheckpoint === undefined
            ? {}
            : { checkpointBefore: rawCheckpoint }),
          checkpointAfter,
          targets: [
            inactiveOutcome(
              current.phase === REFRESH_PHASE ? "refresh" : "snapshot",
              household.householdId,
            ),
          ],
        };
      }

      if (current.phase === REFRESH_PHASE) {
        const result = await refresh.refreshMarketValues({
          metadata: refreshMetadata({
            householdId: household.householdId,
            executionKey: input.executionKey,
            scheduledFor: input.scheduledFor,
          }),
          assetClass: "all",
        });
        return {
          ...(rawCheckpoint === undefined
            ? {}
            : { checkpointBefore: rawCheckpoint }),
          checkpointAfter,
          targets: [refreshOutcome(household.householdId, result)],
        };
      }

      const result = await snapshots.project({
        householdId: household.householdId,
        localDate: input.asOfDate,
        sourceCheckpoint: `${input.executionKey}:${hash(household.householdId)}`,
        calculatedAt: input.scheduledFor,
      });
      let outcome: ScheduledTargetOutcome;
      if (result.kind === "projected" || result.kind === "replayed") {
        outcome = {
          targetId: targetId("snapshot", household.householdId),
          outcome:
            result.kind === "replayed"
              ? { kind: "SKIPPED", receipt: "SNAPSHOT_REPLAYED" }
              : { kind: "SUCCEEDED", receipt: "SNAPSHOT_PROJECTED" },
        };
      } else if (result.kind === "validation-error") {
        outcome = {
          targetId: targetId("snapshot", household.householdId),
          outcome: { kind: "FAILED", code: result.code, retryable: false },
        };
      } else {
        outcome = {
          targetId: targetId("snapshot", household.householdId),
          outcome: { kind: "FAILED", code: result.code, retryable: true },
        };
      }
      return {
        ...(rawCheckpoint === undefined
          ? {}
          : { checkpointBefore: rawCheckpoint }),
        checkpointAfter,
        targets: [outcome],
      };
    },
  };
}
