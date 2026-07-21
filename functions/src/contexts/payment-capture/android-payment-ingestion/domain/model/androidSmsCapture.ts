export interface SmsNotificationEnvelope {
  readonly packageName: string;
  readonly postedAt: string;
  readonly title?: string;
  readonly text?: string;
  readonly bigText?: string;
  readonly textLines?: readonly string[];
}

export interface SmsCandidateSnapshot {
  readonly ordinal: 0 | 1 | 2;
  readonly removedLeadingLines: 0 | 1 | 2;
  readonly body: string;
}

export type SmsCaptureResult =
  | {
      readonly kind: "Parsed";
      readonly selectedCandidate: SmsCandidateSnapshot;
      readonly parserId: string;
      readonly payment: {
        readonly type: "approval" | "cancellation";
        readonly amountInWon: number;
        readonly merchant: string;
      };
      readonly candidates: readonly SmsCandidateSnapshot[];
    }
  | {
      readonly kind: "Ignored";
      readonly code: "UNSUPPORTED_SOURCE" | "NO_SUPPORTED_PAYMENT";
      readonly candidates: readonly SmsCandidateSnapshot[];
    };
