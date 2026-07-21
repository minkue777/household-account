export interface RefreshDisclosure {
  sourceDisclosureId: string;
  instrumentCode: string;
  publishedAt: string;
  paymentDate: string;
  totalAmount: number;
}

export interface DividendRefreshJobResult {
  kind: "complete" | "partial-failure";
  runId: string;
  scheduledFor: string;
  succeededInstrumentCodes: readonly string[];
  retryableFailed: readonly { instrumentCode: string; code: string }[];
  lifecycleSweepCompleted: boolean;
  projectionStatus: "queued" | "up-to-date";
}

export interface DividendRefreshJobEvent {
  eventType: "DividendEventChanged.v1";
  sourceDisclosureId: string;
  instrumentCode: string;
}

export interface DividendRefreshSchedule {
  zoneId: "Asia/Seoul";
  cron: "0 9-20 * * *";
  dailyHours: readonly number[];
}
