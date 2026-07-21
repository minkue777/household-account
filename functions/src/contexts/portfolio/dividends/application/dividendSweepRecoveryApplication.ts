import { pageItems } from "../../../../platform/pagination/public";
import type {
  EligibilityEvidence,
  RecoverEligibilityResult,
  SweepDividendEventView,
} from "../domain/model/dividendSweepRecovery";
import { selectNearestPositionSnapshots } from "../domain/policies/dividendEligibilityPolicy";
import type { DividendSweepRecovery } from "./ports/in/dividendSweepRecovery";
import type {
  DividendSweepRecoveryStore,
  PositionHistoryReader,
} from "./ports/out/dividendSweepRecoveryPorts";

export function createDividendSweepRecoveryApplication(dependencies: {
  history: PositionHistoryReader;
  store: DividendSweepRecoveryStore;
  pageSize: number;
}): DividendSweepRecovery {
  async function recover(
    event: SweepDividendEventView,
    recordDate = event.recordDate,
  ): Promise<RecoverEligibilityResult> {
    const observations = [];
    let cursor: string | undefined;
    do {
      const page = await dependencies.history.page({
        eventId: event.eventId,
        cursor,
      });
      if (page.kind === "no-data") {
        return { kind: "no-data", code: "POSITION_HISTORY_NOT_OBSERVED" };
      }
      if (page.kind === "retryable-failure") return page;
      observations.push(...page.observations);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    const selected = selectNearestPositionSnapshots({
      instrumentCode: event.instrumentCode,
      recordDate,
      snapshots: observations.filter(({ assetId }) =>
        event.sourceAssetIds.includes(assetId),
      ),
    });
    if (selected.length === 0) {
      return { kind: "no-data", code: "POSITION_HISTORY_NOT_OBSERVED" };
    }
    const evidence: EligibilityEvidence[] = selected.map((snapshot) => ({
      assetId: snapshot.assetId,
      selectedSnapshotDate: snapshot.snapshotDate,
      selectedObservedAt: snapshot.observedAt,
      sourceVersion: snapshot.sourceVersion,
      quantity: snapshot.quantity,
      selectionKind: snapshot.snapshotDate === recordDate ? "exact" : "nearest",
    }));
    return {
      kind: "success",
      eventId: event.eventId,
      eligibleQuantity: evidence.reduce(
        (total, item) => total + item.quantity,
        0,
      ),
      evidence,
    };
  }

  return {
    async recoverEligibility(eventId) {
      const event = dependencies.store.event(eventId);
      return event === undefined
        ? { kind: "no-data", code: "POSITION_HISTORY_NOT_OBSERVED" }
        : recover(event);
    },

    async runLifecycleSweep(input) {
      const replay = dependencies.store.occurrenceReceipt(input.occurrenceId);
      if (replay !== undefined) return replay;
      const events = dependencies.store.events();
      const pages = pageItems(events, dependencies.pageSize);
      const pageReceipts = [];
      const changedEventIds: string[] = [];
      const retryableFailures: { eventId: string; code: string }[] = [];

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex];
        for (const current of page) {
          if (current.status === "paid") continue;
          let next: SweepDividendEventView | undefined;
          if (
            current.status === "announced" &&
            input.asOfDate >= current.recordDate
          ) {
            const eligibility = await recover(current);
            if (eligibility.kind !== "success") {
              retryableFailures.push({
                eventId: current.eventId,
                code: eligibility.code,
              });
              continue;
            }
            next = {
              ...current,
              status: "fixed",
              eligibleQuantity: eligibility.eligibleQuantity,
              totalAmountInWon: Math.round(
                eligibility.eligibleQuantity * current.perShareAmountInWon,
              ),
              aggregateVersion: current.aggregateVersion + 1,
            };
          } else if (
            current.status === "fixed" &&
            input.asOfDate >= current.paymentDate
          ) {
            next = {
              ...current,
              status: "paid",
              aggregateVersion: current.aggregateVersion + 1,
            };
          }
          if (next === undefined) continue;
          dependencies.store.commitTransition({
            occurrenceId: input.occurrenceId,
            event: next,
            receipt: {
              receiptId: `${input.occurrenceId}:${current.eventId}`,
              occurrenceId: input.occurrenceId,
              eventId: current.eventId,
              fromStatus: current.status,
              toStatus: next.status,
              resultingVersion: next.aggregateVersion,
            },
            changedEvent: {
              eventType: "DividendEventChanged.v1",
              eventId: next.eventId,
              aggregateVersion: next.aggregateVersion,
              status: next.status,
            },
          });
          changedEventIds.push(current.eventId);
        }
        pageReceipts.push({
          pageNumber: pageIndex + 1,
          eventIds: page.map(({ eventId }) => eventId),
          checkpointAfter: `${input.occurrenceId}:page:${pageIndex + 1}`,
          terminal: true as const,
        });
      }
      const result = {
        kind:
          retryableFailures.length === 0
            ? ("complete" as const)
            : ("partial-failure" as const),
        occurrenceId: input.occurrenceId,
        pageReceipts,
        changedEventIds,
        retryableFailures,
      };
      dependencies.store.saveOccurrenceReceipt(input.occurrenceId, result);
      return result;
    },

    async applyUnpaidCorrection(command) {
      const replay = dependencies.store.correctionReceipt(command.idempotencyKey);
      if (replay !== undefined) return replay;
      const current = dependencies.store.event(command.eventId);
      if (current === undefined) {
        throw new Error(`배당 이벤트를 찾을 수 없습니다: ${command.eventId}`);
      }
      if (current.status === "paid") {
        return {
          kind: "already-processed",
          code: "PAID_DIVIDEND_IMMUTABLE",
        };
      }
      const eligibility = await recover(current, command.recordDate);
      if (eligibility.kind !== "success") {
        throw new Error(`배당 수량 복구 실패: ${eligibility.code}`);
      }
      const event: SweepDividendEventView = {
        ...current,
        sourceDisclosureId: command.sourceDisclosureId,
        recordDate: command.recordDate,
        paymentDate: command.paymentDate,
        perShareAmountInWon: command.perShareAmountInWon,
        eligibleQuantity: eligibility.eligibleQuantity,
        totalAmountInWon: Math.round(
          eligibility.eligibleQuantity * command.perShareAmountInWon,
        ),
        aggregateVersion: current.aggregateVersion + 1,
      };
      const result = { kind: "success" as const, event };
      dependencies.store.commitCorrection({
        idempotencyKey: command.idempotencyKey,
        event,
        result,
        changedEvent: {
          eventType: "DividendEventChanged.v1",
          eventId: event.eventId,
          aggregateVersion: event.aggregateVersion,
          status: event.status,
        },
      });
      return result;
    },
    getEvent: async (eventId) => dependencies.store.event(eventId),
    listEvents: async () => dependencies.store.events(),
    receipts: () => dependencies.store.receipts(),
    recordedEvents: () => dependencies.store.changedEvents(),
  };
}
