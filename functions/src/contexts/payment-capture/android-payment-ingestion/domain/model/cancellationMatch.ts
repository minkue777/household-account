export interface CancellationCardEvidence {
  readonly companyLabel: string;
  readonly lastFour: string;
}

export interface CancellationObservation {
  readonly cancellationDate: string | null;
  readonly observedDate: string;
  readonly amountInWon: number;
  readonly merchant: string;
  readonly card: CancellationCardEvidence;
}

export interface CancellationCandidateFact {
  readonly captureLineageId: string;
  readonly approvalDate: string;
  readonly amountInWon: number;
  readonly merchant: string;
  readonly card: CancellationCardEvidence;
  readonly monthlySplit?: {
    readonly groupTotalInWon: number;
    readonly splitCount: number;
  };
}

export interface CancellationSearchWindow {
  readonly startDateInclusive: string;
  readonly endDateInclusive: string;
}

export type CancellationMatchResult =
  | { readonly kind: "matched"; readonly captureLineageId: string }
  | { readonly kind: "notFound"; readonly resource: "cancellationTarget" }
  | {
      readonly kind: "needsConfirmation";
      readonly captureLineageIds: readonly string[];
    };
