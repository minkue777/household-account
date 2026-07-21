import type {
  DisclosureRequestObservation,
  DividendAnnouncementEvent,
  DividendRefreshResult,
  RunDividendDiscoveryCommand,
} from "../../../domain/model/dividendDiscovery";

export interface DividendDiscovery {
  runDiscovery(
    command: RunDividendDiscoveryCommand,
  ): Promise<DividendRefreshResult>;
  observedDisclosureRequests(): readonly DisclosureRequestObservation[];
  recordedEvents(): readonly DividendAnnouncementEvent[];
}
