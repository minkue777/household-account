import { createDividendDiscoveryApplication } from "../../src/contexts/portfolio/dividends/application/dividendDiscoveryApplication";
import type {
  DividendDiscoveryRunStore,
  DividendHoldingCandidateReader,
  KindDisclosureDiscoverySource,
} from "../../src/contexts/portfolio/dividends/application/ports/out/dividendDiscoveryPorts";
import type {
  DisclosureRequestObservation,
  DividendAnnouncementEvent,
  DividendRefreshResult,
} from "../../src/contexts/portfolio/dividends/public";
import type { HoldingInstrumentCandidate } from "../../src/contexts/portfolio/holdings/public";

export function createDividendDiscoveryEligibilityFixture(seed: {
  holdings: readonly HoldingInstrumentCandidate[];
  disclosuresByCode: Readonly<
    Record<
      string,
      | { kind: "success"; sourceDisclosureId: string }
      | { kind: "no-data"; code: string }
    >
  >;
  pageSize?: number;
}) {
  const pageSize = seed.pageSize ?? Math.max(seed.holdings.length, 1);
  const observations: DisclosureRequestObservation[] = [];
  const receipts = new Map<string, DividendRefreshResult>();
  const events: DividendAnnouncementEvent[] = [];
  const holdings: DividendHoldingCandidateReader = {
    page: async ({ cursor }) => {
      const start = cursor === undefined ? 0 : Number(cursor);
      const items = seed.holdings
        .slice(start, start + pageSize)
        .map((holding) => ({ ...holding }));
      const next = start + items.length;
      return {
        items,
        ...(next < seed.holdings.length ? { nextCursor: String(next) } : {}),
      };
    },
  };
  const disclosures: KindDisclosureDiscoverySource = {
    discover: async ({ request }) => {
      observations.push({ ...request });
      return (
        seed.disclosuresByCode[request.code] ?? {
          kind: "no-data",
          code: "NO_DISCLOSURES",
        }
      );
    },
    observations: () => observations.map((observation) => ({ ...observation })),
  };
  const store: DividendDiscoveryRunStore = {
    receipt: (runId) => {
      const receipt = receipts.get(runId);
      return receipt === undefined ? undefined : structuredClone(receipt);
    },
    commit: (input) => {
      receipts.set(input.runId, structuredClone(input.result));
      events.push(...input.events.map((event) => structuredClone(event)));
    },
    events: () => events.map((event) => structuredClone(event)),
  };
  return createDividendDiscoveryApplication({ holdings, disclosures, store });
}
