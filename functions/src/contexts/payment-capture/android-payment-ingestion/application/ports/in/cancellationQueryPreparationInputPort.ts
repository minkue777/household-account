import type {
  CancellationCardEvidence,
  CancellationObservation,
  CancellationSearchWindow,
} from "../../../domain/model/cancellationMatch";

export interface CancellationPreparationActor {
  readonly householdId: string;
  readonly actingMemberId: string;
}

export interface CancellationPreparationObservation {
  readonly amountInWon: number;
  readonly merchant: string;
  readonly card: CancellationCardEvidence;
  readonly cancellationDate: string | null;
  readonly observedDate: string;
}

export interface PreparedCancellationCandidateQuery {
  readonly queryId: string;
  readonly householdId: string;
  readonly observation: CancellationObservation;
  readonly searchWindow: CancellationSearchWindow;
}

export type CancellationPreparationResult =
  | {
      readonly kind: "Prepared";
      readonly query: PreparedCancellationCandidateQuery;
    }
  | {
      readonly kind: "Rejected";
      readonly code: "HOUSEHOLD_REQUIRED" | "OBSERVED_DATE_INVALID";
    };

export interface CancellationQueryPreparationInputPort {
  prepare(input: {
    readonly actor?: CancellationPreparationActor;
    readonly observation: CancellationPreparationObservation;
    readonly merchantMapping?: { readonly replacementMerchant: string };
  }): CancellationPreparationResult;
}
