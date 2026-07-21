export interface NotificationSourceInput {
  readonly packageName: string;
  readonly postedAt: string;
  readonly title?: string;
  readonly body: string;
}

export interface ParsedPaymentEvidence {
  readonly observationType: "approval" | "cancellation";
  readonly amountInWon: number;
  readonly merchant: string;
}

export interface SelectedSourceEvidence {
  readonly kind: "android-registered-package";
  readonly packageName: string;
  readonly sourceType: string;
  readonly registryVersion: string;
}

export interface SelectedParserEvidence {
  readonly parserId: string;
  readonly parserVersion: string;
}

export type SourceSelectionResult =
  | {
      readonly kind: "parsed";
      readonly source: SelectedSourceEvidence;
      readonly parser: SelectedParserEvidence;
      readonly payment: ParsedPaymentEvidence;
    }
  | { readonly kind: "ignored"; readonly code: "UNSUPPORTED_SOURCE" }
  | {
      readonly kind: "ignored";
      readonly code: "PARSE_FAILED";
      readonly source: SelectedSourceEvidence;
      readonly parser: SelectedParserEvidence;
    };

export interface SourceRegistrySelectionInputPort {
  parse(input: NotificationSourceInput): SourceSelectionResult;
}
