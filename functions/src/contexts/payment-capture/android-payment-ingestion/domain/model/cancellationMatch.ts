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
  /** 불변 승인 기록에서 확인한 원승인 금액이며 분할 합계가 아닙니다. */
  readonly amountInWon: number;
  readonly merchant: string;
  readonly card: CancellationCardEvidence;
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
