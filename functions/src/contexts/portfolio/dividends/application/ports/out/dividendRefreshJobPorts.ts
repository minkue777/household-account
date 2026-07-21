import type {
  DividendRefreshJobEvent,
  DividendRefreshJobResult,
  RefreshDisclosure,
} from "../../../domain/model/dividendRefreshJob";

export type RefreshDisclosureResult =
  | { kind: "success"; disclosures: readonly RefreshDisclosure[] }
  | { kind: "retryable-failure"; code: string };

export interface DividendRefreshDisclosureSource {
  instrumentCodes(): readonly string[];
  collect(input: {
    instrumentCode: string;
    scheduledFor: string;
  }): Promise<RefreshDisclosureResult>;
}

export interface DividendRefreshJobStore {
  receipt(runId: string): DividendRefreshJobResult | undefined;
  hasDisclosure(sourceDisclosureId: string): boolean;
  commitOccurrence(input: {
    runId: string;
    result: DividendRefreshJobResult;
    disclosures: readonly RefreshDisclosure[];
    events: readonly DividendRefreshJobEvent[];
  }): void;
  disclosures(): readonly RefreshDisclosure[];
  events(): readonly DividendRefreshJobEvent[];
}
