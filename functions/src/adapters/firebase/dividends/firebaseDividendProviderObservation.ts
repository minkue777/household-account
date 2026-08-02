import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { logger } from "firebase-functions";

import type { DividendProviderObservationPort } from "../../../contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import {
  decideDividendProviderRunHealth,
  type DividendProviderRunCounts,
  type PreviousDividendProviderHealth,
} from "../../../contexts/portfolio/dividends/domain/policies/dividendProviderRunHealthPolicy";
import {
  CloudMonitoringProviderAlertLogger,
  configuredMonitoringNotificationChannel,
} from "../operations/firebaseProviderHealth";

const PROVIDER = "KIND";
const OPERATION = "dividend-disclosure";

type TargetResultKind =
  | "SUCCESS"
  | "NO_DATA"
  | "RETRYABLE_FAILURE"
  | "CONTRACT_FAILURE";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runtimeCollection(
  database: firestore.Firestore,
  name: string,
): firestore.CollectionReference {
  return database.collection("operations").doc("runtime").collection(name);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function nonnegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function resultKind(value: unknown): TargetResultKind | undefined {
  return value === "SUCCESS" ||
    value === "NO_DATA" ||
    value === "RETRYABLE_FAILURE" ||
    value === "CONTRACT_FAILURE"
    ? value
    : undefined;
}

function previousHealth(
  data: firestore.DocumentData | undefined,
): PreviousDividendProviderHealth | undefined {
  const lastAttemptAt = text(data?.lastAttemptAt);
  if (lastAttemptAt === undefined) return undefined;
  const lastSuccessAt = text(data?.lastSuccessAt);
  const failureStartedAt = text(data?.failureStartedAt);
  return {
    lastAttemptAt,
    ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
    consecutiveFailedRuns: nonnegativeInteger(data?.consecutiveFailedRuns),
    ...(failureStartedAt === undefined ? {} : { failureStartedAt }),
    alertState: data?.alertState === "open" ? "open" : "closed",
    version: nonnegativeInteger(data?.version),
  };
}

function runCounts(
  observations: readonly TargetResultKind[],
): DividendProviderRunCounts {
  return {
    success: observations.filter((kind) => kind === "SUCCESS").length,
    noData: observations.filter((kind) => kind === "NO_DATA").length,
    retryableFailure: observations.filter(
      (kind) => kind === "RETRYABLE_FAILURE",
    ).length,
    contractFailure: observations.filter(
      (kind) => kind === "CONTRACT_FAILURE",
    ).length,
  };
}

interface StoredTargetObservation {
  readonly targetHash: string;
  readonly resultKind: TargetResultKind;
  readonly errorCode?: string;
}

function targetObservation(
  document: firestore.QueryDocumentSnapshot,
): StoredTargetObservation | undefined {
  const data = document.data();
  const targetHash = text(data.targetHash);
  const kind = resultKind(data.resultKind);
  if (targetHash === undefined || kind === undefined) return undefined;
  const errorCode = text(data.errorCode);
  return {
    targetHash,
    resultKind: kind,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function representativeFailure(
  observations: readonly StoredTargetObservation[],
): StoredTargetObservation | undefined {
  return observations
    .filter(
      ({ resultKind: kind }) =>
        kind === "CONTRACT_FAILURE" || kind === "RETRYABLE_FAILURE",
    )
    .sort(
      (left, right) =>
        Number(right.resultKind === "CONTRACT_FAILURE") -
          Number(left.resultKind === "CONTRACT_FAILURE") ||
        (left.errorCode ?? "").localeCompare(right.errorCode ?? "") ||
        left.targetHash.localeCompare(right.targetHash),
    )[0];
}

export class FirebaseDividendProviderObservation
  implements DividendProviderObservationPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async record(
    input: Parameters<DividendProviderObservationPort["record"]>[0],
  ): Promise<void> {
    const executionKeyHash = hash(input.executionKey);
    const targetHash = hash(input.targetId);
    const receipt = runtimeCollection(
      this.database,
      "providerObservationReceipts",
    ).doc(hash(`${input.executionKey}\u0000${input.targetId}`));
    const created = await this.database.runTransaction(async (transaction) => {
      if ((await transaction.get(receipt)).exists) return false;
      transaction.create(receipt, {
        schemaVersion: 2,
        provider: PROVIDER,
        operation: OPERATION,
        executionKeyHash,
        targetHash,
        resultKind: input.resultKind,
        ...(input.errorCode === undefined
          ? {}
          : { errorCode: input.errorCode }),
        attempts: input.attempts,
        ...(input.httpStatus === undefined
          ? {}
          : { httpStatus: input.httpStatus }),
        ...(input.stage === undefined ? {} : { stage: input.stage }),
        observedAt: input.observedAt,
      });
      return true;
    });
    if (!created) return;

    const payload = {
      eventType: "PROVIDER_TARGET_OUTCOME",
      provider: PROVIDER,
      operation: OPERATION,
      executionKeyHash,
      targetHash,
      resultKind: input.resultKind,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      attempts: input.attempts,
      ...(input.httpStatus === undefined
        ? {}
        : { httpStatus: input.httpStatus }),
      ...(input.stage === undefined ? {} : { stage: input.stage }),
      observedAt: input.observedAt,
    };
    if (input.resultKind === "SUCCESS" || input.resultKind === "NO_DATA") {
      logger.info("provider-target-operation", payload);
    } else {
      logger.error("provider-target-operation", payload);
    }
  }

  async finalizeRun(
    input: Parameters<DividendProviderObservationPort["finalizeRun"]>[0],
  ): Promise<void> {
    const executionKeyHash = hash(input.executionKey);
    const targetReceipts = await runtimeCollection(
      this.database,
      "providerObservationReceipts",
    )
      .where("executionKeyHash", "==", executionKeyHash)
      .get();
    const observations = targetReceipts.docs.flatMap((document) => {
      const observation = targetObservation(document);
      return observation === undefined ? [] : [observation];
    });
    if (observations.length === 0) return;

    const counts = runCounts(observations.map(({ resultKind: kind }) => kind));
    const failure = representativeFailure(observations);
    const healthReference = runtimeCollection(
      this.database,
      "providerHealth",
    ).doc(hash(`${PROVIDER}\u0000${OPERATION}`));
    const finalizationReceipt = runtimeCollection(
      this.database,
      "providerHealthRunReceipts",
    ).doc(hash(`${PROVIDER}\u0000${OPERATION}\u0000${input.executionKey}`));

    const committed = await this.database.runTransaction(async (transaction) => {
      const [finalizationSnapshot, healthSnapshot] = await Promise.all([
        transaction.get(finalizationReceipt),
        transaction.get(healthReference),
      ]);
      if (finalizationSnapshot.exists) {
        return { kind: "replayed" as const };
      }

      const previous = previousHealth(healthSnapshot.data());
      if (
        previous !== undefined &&
        Date.parse(previous.lastAttemptAt) > Date.parse(input.observedAt)
      ) {
        transaction.create(finalizationReceipt, {
          schemaVersion: 1,
          provider: PROVIDER,
          operation: OPERATION,
          executionKeyHash,
          result: "STALE_IGNORED",
          counts,
          observedAt: input.observedAt,
        });
        return { kind: "stale" as const };
      }

      const decision = decideDividendProviderRunHealth({
        observedAt: input.observedAt,
        counts,
        ...(failure?.errorCode === undefined
          ? {}
          : { lastErrorCode: failure.errorCode }),
        ...(previous === undefined ? {} : { previous }),
      });
      if (decision.kind === "ignored") {
        return { kind: "ignored" as const };
      }

      transaction.set(healthReference, {
        schemaVersion: 2,
        provider: PROVIDER,
        operation: OPERATION,
        ...decision.health,
        updatedAt: input.observedAt,
      });
      transaction.create(finalizationReceipt, {
        schemaVersion: 1,
        provider: PROVIDER,
        operation: OPERATION,
        executionKeyHash,
        result: decision.health.lastResultKind,
        counts,
        observedAt: input.observedAt,
      });
      return {
        kind: "committed" as const,
        health: decision.health,
        ...(decision.alertTransition === undefined
          ? {}
          : { alertTransition: decision.alertTransition }),
      };
    });

    if (committed.kind !== "committed") return;
    logger.info("provider-run-health", {
      eventType: "PROVIDER_RUN_HEALTH_OUTCOME",
      provider: PROVIDER,
      operation: OPERATION,
      executionKeyHash,
      status: committed.health.status,
      resultKind: committed.health.lastResultKind,
      targetCount: committed.health.lastRunTargetCount,
      succeededTargets: committed.health.lastRunSucceededTargets,
      failedTargets: committed.health.lastRunFailedTargets,
      consecutiveFailedRuns: committed.health.consecutiveFailedRuns,
      alertState: committed.health.alertState,
      observedAt: input.observedAt,
    });

    if (committed.alertTransition !== undefined) {
      await new CloudMonitoringProviderAlertLogger().transition({
        alertIdentity: `provider-health:${hash(`${PROVIDER}:${OPERATION}`)}`,
        transition: committed.alertTransition,
        notificationChannelResource: configuredMonitoringNotificationChannel(),
        occurredAt: input.observedAt,
      });
    }
  }
}
