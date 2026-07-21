import { createDividendEventId } from "../domain/entities/dividendEvent";
import type {
  DividendAnnouncementEvent,
  DividendRefreshResult,
} from "../domain/model/dividendDiscovery";
import type { DividendDiscovery } from "./ports/in/dividendDiscovery";
import type {
  DividendDiscoveryRunStore,
  DividendHoldingCandidateReader,
  KindDisclosureDiscoverySource,
} from "./ports/out/dividendDiscoveryPorts";

export function createDividendDiscoveryApplication(dependencies: {
  holdings: DividendHoldingCandidateReader;
  disclosures: KindDisclosureDiscoverySource;
  store: DividendDiscoveryRunStore;
}): DividendDiscovery {
  return {
    async runDiscovery(command) {
      const replay = dependencies.store.receipt(command.runId);
      if (replay !== undefined) return replay;

      const codes: string[] = [];
      const seenCodes = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await dependencies.holdings.page({
          householdId: command.householdId,
          cursor,
        });
        for (const holding of page.items) {
          if (
            holding.lifecycle === "active" &&
            holding.market === "KRX" &&
            holding.instrumentType === "ETF" &&
            !seenCodes.has(holding.code)
          ) {
            seenCodes.add(holding.code);
            codes.push(holding.code);
          }
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);

      const succeeded: DividendRefreshResult["succeeded"][number][] = [];
      const noData: DividendRefreshResult["noData"][number][] = [];
      const retryableFailed: DividendRefreshResult["retryableFailed"][number][] = [];
      const events: DividendAnnouncementEvent[] = [];
      for (const code of codes) {
        const result = await dependencies.disclosures.discover({
          request: { market: "KRX", instrumentType: "ETF", code },
          periodFrom: command.periodFrom,
          periodTo: command.periodTo,
        });
        if (result.kind === "no-data") {
          noData.push({ instrumentCode: code, code: result.code });
          continue;
        }
        if (result.kind === "retryable-failure") {
          retryableFailed.push({ instrumentCode: code, code: result.code });
          continue;
        }
        const eventId = createDividendEventId(result.sourceDisclosureId);
        succeeded.push({
          target: { kind: "INSTRUMENT", instrumentCode: code },
          changedEventIds: [eventId],
        });
        events.push({
          eventType: "DividendEventChanged.v1",
          eventId,
          instrument: { market: "KRX", instrumentType: "ETF", code },
          status: "announced",
        });
      }
      const result: DividendRefreshResult = {
        phase: "DISCOVERY",
        completed: true,
        succeeded,
        noData,
        retryableFailed,
      };
      dependencies.store.commit({ runId: command.runId, result, events });
      return result;
    },
    observedDisclosureRequests: () => dependencies.disclosures.observations(),
    recordedEvents: () => dependencies.store.events(),
  };
}
