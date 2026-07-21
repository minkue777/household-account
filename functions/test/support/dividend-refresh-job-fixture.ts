import { createDividendRefreshJobApplication } from "../../src/contexts/portfolio/dividends/application/dividendRefreshJobApplication";
import type {
  DividendRefreshDisclosureSource,
  DividendRefreshJobStore,
} from "../../src/contexts/portfolio/dividends/application/ports/out/dividendRefreshJobPorts";
import type {
  DividendRefreshJobEvent,
  DividendRefreshJobResult,
  RefreshDisclosure,
} from "../../src/contexts/portfolio/dividends/public";

export function createDividendRefreshJobFixture(seed: {
  disclosures: readonly RefreshDisclosure[];
  providerFailureCodes?: Readonly<Record<string, string>>;
}) {
  const codes = [...new Set(seed.disclosures.map(({ instrumentCode }) => instrumentCode))];
  let disclosures: RefreshDisclosure[] = [];
  const events: DividendRefreshJobEvent[] = [];
  const receipts = new Map<string, DividendRefreshJobResult>();
  const source: DividendRefreshDisclosureSource = {
    instrumentCodes: () => [...codes],
    collect: async ({ instrumentCode, scheduledFor }) => {
      const failure = seed.providerFailureCodes?.[instrumentCode];
      if (failure !== undefined) {
        return { kind: "retryable-failure", code: failure };
      }
      return {
        kind: "success",
        disclosures: seed.disclosures
          .filter(
            (disclosure) =>
              disclosure.instrumentCode === instrumentCode &&
              disclosure.publishedAt <= scheduledFor,
          )
          .map((disclosure) => ({ ...disclosure })),
      };
    },
  };
  const store: DividendRefreshJobStore = {
    receipt: (runId) => {
      const result = receipts.get(runId);
      return result === undefined ? undefined : structuredClone(result);
    },
    hasDisclosure: (sourceDisclosureId) =>
      disclosures.some(
        (disclosure) => disclosure.sourceDisclosureId === sourceDisclosureId,
      ),
    commitOccurrence: (input) => {
      receipts.set(input.runId, structuredClone(input.result));
      disclosures = [
        ...disclosures,
        ...input.disclosures.map((disclosure) => ({ ...disclosure })),
      ];
      events.push(...input.events.map((event) => ({ ...event })));
    },
    disclosures: () => disclosures.map((disclosure) => ({ ...disclosure })),
    events: () => events.map((event) => ({ ...event })),
  };
  return createDividendRefreshJobApplication({ source, store });
}
