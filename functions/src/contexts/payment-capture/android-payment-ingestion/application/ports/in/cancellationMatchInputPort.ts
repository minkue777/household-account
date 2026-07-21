import type {
  CancellationCandidateFact,
  CancellationMatchResult,
  CancellationObservation,
  CancellationSearchWindow,
} from "../../../domain/model/cancellationMatch";

export type {
  CancellationCandidateFact,
  CancellationCardEvidence,
  CancellationMatchResult,
  CancellationObservation,
  CancellationSearchWindow,
} from "../../../domain/model/cancellationMatch";

export interface CancellationMatchInputPort {
  buildSearchWindow(input: {
    readonly cancellationDate: string | null;
    readonly observedDate: string;
  }): CancellationSearchWindow;
  decide(input: {
    readonly observation: CancellationObservation;
    readonly candidates: readonly CancellationCandidateFact[];
  }): CancellationMatchResult;
}
