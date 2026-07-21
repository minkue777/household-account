export interface LocalCurrencyMetadataTransaction {
  transactionId: string;
  householdId: string;
  merchant: string;
  amountInWon: number;
  localCurrencyType?: string;
  captureLineageId?: string;
  aggregateVersion: number;
}

export type LocalCurrencyMetadataResult =
  | { kind: "Recorded"; transaction: LocalCurrencyMetadataTransaction }
  | { kind: "Updated"; transaction: LocalCurrencyMetadataTransaction }
  | {
      kind: "ValidationError";
      code:
        | "LOCAL_CURRENCY_TYPE_REQUIRED"
        | "LOCAL_CURRENCY_TYPE_NOT_CAPTURE_VERIFIED"
        | "LOCAL_CURRENCY_TYPE_IMMUTABLE";
    }
  | { kind: "Conflict"; code: "VERSION_MISMATCH" }
  | { kind: "NotFound" };
