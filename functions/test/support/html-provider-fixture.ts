import { createHtmlQuoteParsingApplication } from "../../src/platform/external-operations/application/htmlQuoteParsingApplication";

export interface RecordedHtmlProviderAttempt {
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
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createHtmlProviderFixture() {
  const recorded: RecordedHtmlProviderAttempt[] = [];
  const application = createHtmlQuoteParsingApplication({
    attempts: {
      record(attempt) {
        recorded.push({ ...attempt });
      },
    },
    fingerprint: { fingerprint },
  });

  return {
    parseQuote: application.parseQuote,
    attempts: () => recorded.map((attempt) => ({ ...attempt })),
  };
}
