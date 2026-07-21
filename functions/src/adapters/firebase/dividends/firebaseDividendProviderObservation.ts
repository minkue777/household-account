import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { logger } from "firebase-functions";

import type { DividendProviderObservationPort } from "../../../contexts/portfolio/dividends/application/ports/out/dividendScheduledRuntimePorts";
import {
  CloudMonitoringProviderAlertLogger,
  configuredMonitoringNotificationChannel,
} from "../operations/firebaseProviderHealth";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class FirebaseDividendProviderObservation
  implements DividendProviderObservationPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async record(
    input: Parameters<DividendProviderObservationPort["record"]>[0],
  ): Promise<void> {
    const provider = "KIND";
    const operation = "dividend-disclosure";
    const executionKeyHash = hash(input.executionKey);
    const targetHash = hash(input.targetId);
    const receipt = this.database
      .collection("operations")
      .doc("runtime")
      .collection("providerObservationReceipts")
      .doc(hash(`${input.executionKey}\u0000${input.targetId}`));
    const health = this.database
      .collection("operations")
      .doc("runtime")
      .collection("providerHealth")
      .doc(hash(`${provider}\u0000${operation}`));
    let opened = false;
    let resolved = false;
    await this.database.runTransaction(async (transaction) => {
      const [receiptSnapshot, healthSnapshot] = await Promise.all([
        transaction.get(receipt),
        transaction.get(health),
      ]);
      if (receiptSnapshot.exists) return;
      const previous = healthSnapshot.data() ?? {};
      const previousOpen = previous.alertState === "open";
      const successful =
        input.resultKind === "SUCCESS" || input.resultKind === "NO_DATA";
      const consecutiveFailedRuns = successful
        ? 0
        : Number(previous.consecutiveFailedRuns ?? 0) + 1;
      const outage =
        !successful &&
        (input.resultKind === "CONTRACT_FAILURE" || consecutiveFailedRuns >= 3);
      const alertState = successful ? "closed" : outage || previousOpen ? "open" : "closed";
      opened = !previousOpen && alertState === "open";
      resolved = previousOpen && alertState === "closed";
      transaction.set(health, {
        schemaVersion: 1,
        provider,
        operation,
        status: successful ? "healthy" : outage ? "outage" : "degraded",
        lastAttemptAt: input.observedAt,
        ...(successful
          ? { lastSuccessAt: input.observedAt }
          : typeof previous.lastSuccessAt === "string"
            ? { lastSuccessAt: previous.lastSuccessAt }
            : {}),
        consecutiveFailedRuns,
        lastResultKind: input.resultKind,
        ...(input.errorCode === undefined ? {} : { lastErrorCode: input.errorCode }),
        alertState,
        version: Number(previous.version ?? 0) + 1,
        updatedAt: input.observedAt,
      });
      transaction.create(receipt, {
        schemaVersion: 1,
        executionKeyHash,
        targetHash,
        resultKind: input.resultKind,
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        attempts: input.attempts,
        observedAt: input.observedAt,
      });
    });

    const payload = {
      eventType: "PROVIDER_RUN_OUTCOME",
      provider,
      operation,
      executionKeyHash,
      targetHash,
      resultKind: input.resultKind,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      attempts: input.attempts,
      observedAt: input.observedAt,
    };
    if (input.resultKind === "SUCCESS" || input.resultKind === "NO_DATA") {
      logger.info("provider-operation", payload);
    } else {
      logger.error("provider-operation", payload);
    }
    if (opened) {
      await new CloudMonitoringProviderAlertLogger().transition({
        alertIdentity: `provider-health:${hash(`${provider}:${operation}`)}`,
        transition: "opened",
        notificationChannelResource: configuredMonitoringNotificationChannel(),
        occurredAt: input.observedAt,
      });
    } else if (resolved) {
      await new CloudMonitoringProviderAlertLogger().transition({
        alertIdentity: `provider-health:${hash(`${provider}:${operation}`)}`,
        transition: "resolved",
        notificationChannelResource: configuredMonitoringNotificationChannel(),
        occurredAt: input.observedAt,
      });
    }
  }
}
