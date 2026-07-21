export interface ProviderAttemptRecorderPort {
  record(input: {
    readonly provider: string;
    readonly operation: "quote-html-parse";
    readonly resultKind:
      | "success"
      | "no-data"
      | "contract-failure"
      | "invalid-data";
    readonly code?: string;
    readonly selectorContractVersion: 1;
    readonly payloadFingerprint: string;
  }): void;
}

export interface PayloadFingerprintPort {
  fingerprint(payload: string): string;
}
