export interface DisclosureRequestObservation {
  market: "KRX";
  instrumentType: "ETF";
  code: string;
}

export interface DividendRefreshResult {
  phase: "DISCOVERY";
  completed: boolean;
  succeeded: readonly {
    target: { kind: "INSTRUMENT"; instrumentCode: string };
    changedEventIds: readonly string[];
  }[];
  noData: readonly { instrumentCode: string; code: string }[];
  retryableFailed: readonly { instrumentCode: string; code: string }[];
}

export interface DividendAnnouncementEvent {
  eventType: "DividendEventChanged.v1";
  eventId: string;
  instrument: {
    market: "KRX";
    instrumentType: "ETF";
    code: string;
  };
  status: "announced";
}

export interface RunDividendDiscoveryCommand {
  householdId: string;
  runId: string;
  periodFrom: string;
  periodTo: string;
}
