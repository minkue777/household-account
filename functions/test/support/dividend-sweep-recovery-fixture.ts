import { createDividendSweepRecoveryApplication } from "../../src/contexts/portfolio/dividends/application/dividendSweepRecoveryApplication";
import type {
  DividendSweepRecoveryStore,
  PositionHistoryReadResult,
  PositionHistoryReader,
} from "../../src/contexts/portfolio/dividends/application/ports/out/dividendSweepRecoveryPorts";
import type {
  DividendCorrectionResult,
  DividendSweepReceipt,
  DividendSweepResult,
  PositionHistoryObservation,
  SweepDividendChangedEvent,
  SweepDividendEventView,
} from "../../src/contexts/portfolio/dividends/public";

interface PositionHistoryPage {
  cursor?: string;
  nextCursor?: string;
  observations: readonly PositionHistoryObservation[];
}

type PositionHistoryFixture =
  | { kind: "ready"; pages: readonly PositionHistoryPage[] }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

export function createDividendSweepRecoveryFixture(fixture: {
  events: readonly SweepDividendEventView[];
  positionHistoryByEventId: Readonly<Record<string, PositionHistoryFixture>>;
  assetLifecycleById?: Readonly<Record<string, "active" | "deleted" | "purged">>;
  pageSize?: number;
}) {
  let events: SweepDividendEventView[] = fixture.events.map((event) => ({
    ...event,
    sourceAssetIds: [...event.sourceAssetIds],
  }));
  const occurrenceReceipts = new Map<string, DividendSweepResult>();
  const correctionReceipts = new Map<string, DividendCorrectionResult>();
  const receipts: DividendSweepReceipt[] = [];
  const changedEvents: SweepDividendChangedEvent[] = [];

  const history: PositionHistoryReader = {
    page: async ({ eventId, cursor }): Promise<PositionHistoryReadResult> => {
      const source = fixture.positionHistoryByEventId[eventId];
      if (source === undefined || source.kind === "no-data") {
        return { kind: "no-data" };
      }
      if (source.kind === "retryable-failure") return source;
      const page = source.pages.find(
        (candidate, index) =>
          candidate.cursor === cursor ||
          (cursor === undefined && index === 0 && candidate.cursor === undefined),
      );
      return page === undefined
        ? { kind: "no-data" }
        : {
            kind: "ready",
            observations: page.observations.map((observation) => ({
              ...observation,
            })),
            ...(page.nextCursor === undefined
              ? {}
              : { nextCursor: page.nextCursor }),
          };
    },
  };
  const store: DividendSweepRecoveryStore = {
    event: (eventId) => {
      const event = events.find((candidate) => candidate.eventId === eventId);
      return event === undefined ? undefined : structuredClone(event);
    },
    events: () => events.map((event) => structuredClone(event)),
    occurrenceReceipt: (occurrenceId) => {
      const receipt = occurrenceReceipts.get(occurrenceId);
      return receipt === undefined ? undefined : structuredClone(receipt);
    },
    correctionReceipt: (idempotencyKey) => {
      const receipt = correctionReceipts.get(idempotencyKey);
      return receipt === undefined ? undefined : structuredClone(receipt);
    },
    commitTransition: (input) => {
      events = events.map((event) =>
        event.eventId === input.event.eventId
          ? structuredClone(input.event)
          : event,
      );
      receipts.push({ ...input.receipt });
      changedEvents.push({ ...input.changedEvent });
    },
    saveOccurrenceReceipt: (occurrenceId, result) =>
      occurrenceReceipts.set(occurrenceId, structuredClone(result)),
    commitCorrection: (input) => {
      events = events.map((event) =>
        event.eventId === input.event.eventId
          ? structuredClone(input.event)
          : event,
      );
      correctionReceipts.set(
        input.idempotencyKey,
        structuredClone(input.result),
      );
      changedEvents.push({ ...input.changedEvent });
    },
    receipts: () => receipts.map((receipt) => ({ ...receipt })),
    changedEvents: () => changedEvents.map((event) => ({ ...event })),
  };
  return createDividendSweepRecoveryApplication({
    history,
    store,
    pageSize: fixture.pageSize ?? 50,
  });
}
