import type { HoldingInstrumentCandidate } from "../../../../holdings/public";
import type {
  DisclosureRequestObservation,
  DividendAnnouncementEvent,
  DividendRefreshResult,
} from "../../../domain/model/dividendDiscovery";

export interface DividendHoldingCandidateReader {
  page(input: {
    householdId: string;
    cursor?: string;
  }): Promise<{
    items: readonly HoldingInstrumentCandidate[];
    nextCursor?: string;
  }>;
}

export type DisclosureDiscoveryResult =
  | { kind: "success"; sourceDisclosureId: string }
  | { kind: "no-data"; code: string }
  | { kind: "retryable-failure"; code: string };

export interface KindDisclosureDiscoverySource {
  discover(input: {
    request: DisclosureRequestObservation;
    periodFrom: string;
    periodTo: string;
  }): Promise<DisclosureDiscoveryResult>;
  observations(): readonly DisclosureRequestObservation[];
}

export interface DividendDiscoveryRunStore {
  receipt(runId: string): DividendRefreshResult | undefined;
  commit(input: {
    runId: string;
    result: DividendRefreshResult;
    events: readonly DividendAnnouncementEvent[];
  }): void;
  events(): readonly DividendAnnouncementEvent[];
}
