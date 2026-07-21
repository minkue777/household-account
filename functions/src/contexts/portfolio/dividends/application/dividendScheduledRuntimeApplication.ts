import { selectNearestPositionSnapshots } from "../domain/policies/dividendEligibilityPolicy";
import type {
  DividendLifecycleEvidence,
  DividendScheduledRuntimeDependencies,
  KindDividendDiscoveryResult,
  ScheduledDividendEvent,
} from "./ports/out/dividendScheduledRuntimePorts";

export interface DividendScheduledTargetOutcome {
  readonly targetId: string;
  readonly kind: "succeeded" | "skipped" | "failed";
  readonly receipt?: string;
  readonly code?: string;
  readonly retryable?: boolean;
}

export interface DividendScheduledPageResult {
  readonly items: readonly DividendScheduledTargetOutcome[];
  readonly nextCursor?: string;
}

function providerResultKind(
  result: KindDividendDiscoveryResult,
): "SUCCESS" | "NO_DATA" | "RETRYABLE_FAILURE" | "CONTRACT_FAILURE" {
  if (result.kind === "success") return "SUCCESS";
  if (result.kind === "no-data") return "NO_DATA";
  return result.kind === "retryable-failure"
    ? "RETRYABLE_FAILURE"
    : "CONTRACT_FAILURE";
}

function providerOutcome(
  targetId: string,
  result: KindDividendDiscoveryResult,
  changedEventIds: readonly string[] = [],
): DividendScheduledTargetOutcome {
  if (result.kind === "success") {
    return {
      targetId,
      kind: "succeeded",
      receipt: changedEventIds.length === 0 ? "NO_CHANGE" : changedEventIds.join(","),
    };
  }
  if (result.kind === "no-data") {
    return { targetId, kind: "skipped", receipt: result.code };
  }
  return {
    targetId,
    kind: "failed",
    code: result.code,
    retryable: result.kind === "retryable-failure",
  };
}

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index]!);
      }
    }),
  );
  return results;
}

function lifecycleOutcome(
  event: ScheduledDividendEvent,
  status: "fixed" | "paid",
  aggregateVersion: number,
): DividendScheduledTargetOutcome {
  return {
    targetId: `event:${event.eventId}`,
    kind: "succeeded",
    receipt: `${status}:v${aggregateVersion}`,
  };
}

export function createDividendScheduledRuntimeApplication(
  dependencies: DividendScheduledRuntimeDependencies,
) {
  return {
    async runDiscoveryPage(input: {
      readonly cursor?: string;
      readonly limit: number;
      readonly concurrency: number;
      readonly periodFrom: string;
      readonly periodTo: string;
      readonly executionKey: string;
      readonly observedAt: string;
    }): Promise<DividendScheduledPageResult> {
      const page = await dependencies.holdings.listActiveKrxEtfTargets({
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: input.limit,
      });
      const byInstrument = new Map<
        string,
        Promise<KindDividendDiscoveryResult>
      >();
      const items = await boundedMap(
        page.items,
        input.concurrency,
        async (target): Promise<DividendScheduledTargetOutcome> => {
          let discovery = byInstrument.get(target.instrument.code);
          if (discovery === undefined) {
            discovery = (async () => {
              const result = await dependencies.disclosures.discover({
                instrumentCode: target.instrument.code,
                instrumentName: target.instrument.name,
                periodFrom: input.periodFrom,
                periodTo: input.periodTo,
              });
              await dependencies.providerObservations.record({
                executionKey: input.executionKey,
                targetId: `instrument:${target.instrument.code}`,
                resultKind: providerResultKind(result),
                ...(result.kind === "success" ? {} : { errorCode: result.code }),
                attempts: result.attempts,
                observedAt: input.observedAt,
              });
              return result;
            })();
            byInstrument.set(target.instrument.code, discovery);
          }
          const result = await discovery;
          if (result.kind !== "success") return providerOutcome(target.targetId, result);

          const changedEventIds: string[] = [];
          for (const disclosure of result.disclosures) {
            const upsert = await dependencies.events.upsertAnnouncement({
              target,
              disclosure,
              observedAt: input.observedAt,
              idempotencyKey: `${input.executionKey}:discovery:${target.targetId}:${disclosure.sourceDisclosureId}`,
            });
            if (
              upsert.kind === "created" ||
              upsert.kind === "changed" ||
              upsert.kind === "removed"
            ) {
              changedEventIds.push(upsert.eventId);
            }
          }
          return providerOutcome(target.targetId, result, changedEventIds);
        },
      );
      return {
        items,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },

    async runLifecyclePage(input: {
      readonly cursor?: string;
      readonly limit: number;
      readonly executionKey: string;
      readonly asOfDate: string;
      readonly observedAt: string;
    }): Promise<DividendScheduledPageResult> {
      const page = await dependencies.events.listNonterminal({
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: input.limit,
      });
      const items: DividendScheduledTargetOutcome[] = [];
      for (const event of page.items) {
        if (event.status === "fixed") {
          if (input.asOfDate < event.paymentDate) {
            items.push({
              targetId: `event:${event.eventId}`,
              kind: "skipped",
              receipt: "PAYMENT_DATE_NOT_REACHED",
            });
            continue;
          }
          const transition = await dependencies.events.transition({
            event,
            targetStatus: "paid",
            observedAt: input.observedAt,
            idempotencyKey: `${input.executionKey}:paid:${event.eventId}`,
          });
          items.push(
            transition.kind === "changed"
              ? lifecycleOutcome(event, transition.status, transition.aggregateVersion)
              : {
                  targetId: `event:${event.eventId}`,
                  kind: "skipped",
                  receipt: transition.code,
                },
          );
          continue;
        }
        if (input.asOfDate < event.recordDate) {
          items.push({
            targetId: `event:${event.eventId}`,
            kind: "skipped",
            receipt: "RECORD_DATE_NOT_REACHED",
          });
          continue;
        }
        const observations = await dependencies.holdings.listPositionHistory({
          householdId: event.householdId,
          sourceAssetIds: event.sourceAssetIds,
          instrumentCode: event.instrumentCode,
        });
        const selected = selectNearestPositionSnapshots({
          instrumentCode: event.instrumentCode,
          recordDate: event.recordDate,
          snapshots: observations.map((observation) => ({
            assetId: observation.assetId,
            instrumentCode: observation.instrumentCode,
            snapshotDate: observation.snapshotDate,
            quantity: observation.quantity,
            observedAt: observation.observedAt,
            sourceVersion: observation.sourceVersion,
          })),
        });
        if (selected.length === 0) {
          items.push({
            targetId: `event:${event.eventId}`,
            kind: "skipped",
            receipt: "POSITION_HISTORY_NOT_OBSERVED",
          });
          continue;
        }
        const evidence: DividendLifecycleEvidence[] = selected.map(
          (observation) => ({
            assetId: observation.assetId,
            snapshotDate: observation.snapshotDate,
            observedAt: observation.observedAt,
            sourceVersion: observation.sourceVersion,
            quantity: observation.quantity,
            selectionKind:
              observation.snapshotDate === event.recordDate ? "exact" : "nearest",
          }),
        );
        const fixed = await dependencies.events.transition({
          event,
          targetStatus: "fixed",
          observedAt: input.observedAt,
          eligibleQuantity: evidence.reduce((sum, item) => sum + item.quantity, 0),
          evidence,
          idempotencyKey: `${input.executionKey}:fixed:${event.eventId}`,
        });
        if (fixed.kind !== "changed") {
          items.push({
            targetId: `event:${event.eventId}`,
            kind: "skipped",
            receipt: fixed.code,
          });
          continue;
        }
        if (input.asOfDate < event.paymentDate) {
          items.push(lifecycleOutcome(event, fixed.status, fixed.aggregateVersion));
          continue;
        }
        const paid = await dependencies.events.transition({
          event: {
            ...event,
            status: "fixed",
            eligibleQuantity: evidence.reduce((sum, item) => sum + item.quantity, 0),
            totalAmount: Math.round(
              evidence.reduce((sum, item) => sum + item.quantity, 0) *
                event.perShareAmount,
            ),
            aggregateVersion: fixed.aggregateVersion,
          },
          targetStatus: "paid",
          observedAt: input.observedAt,
          idempotencyKey: `${input.executionKey}:paid:${event.eventId}`,
        });
        items.push(
          paid.kind === "changed"
            ? lifecycleOutcome(event, paid.status, paid.aggregateVersion)
            : lifecycleOutcome(event, fixed.status, fixed.aggregateVersion),
        );
      }
      return {
        items,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
  };
}
