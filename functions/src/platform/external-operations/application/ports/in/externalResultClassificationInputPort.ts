import type {
  ExternalResult,
  ProviderObservation,
} from "../../../domain/externalResult";

export interface RetryExecution<T> {
  readonly result: ExternalResult<T>;
  readonly attempts: number;
}

export interface ExternalResultClassificationInputPort {
  mapQuoteObservation(observation: ProviderObservation): ExternalResult<number>;
  mapGoldObservation(observation: ProviderObservation): ExternalResult<number>;
  executeWithRetry(): Promise<RetryExecution<number>>;
}

export type { ExternalResult, ProviderObservation };
