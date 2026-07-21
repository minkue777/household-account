import { parseHtmlQuoteContract } from "../domain/htmlQuoteContract";
import type { HtmlQuoteParsingInputPort } from "./ports/in/htmlQuoteParsingInputPort";
import type {
  PayloadFingerprintPort,
  ProviderAttemptRecorderPort,
} from "./ports/out/providerAttemptRecorderPort";

export function createHtmlQuoteParsingApplication(dependencies: {
  readonly attempts: ProviderAttemptRecorderPort;
  readonly fingerprint: PayloadFingerprintPort;
}): HtmlQuoteParsingInputPort {
  return {
    parseQuote(input) {
      const result = parseHtmlQuoteContract(input);
      dependencies.attempts.record({
        provider: input.provider,
        operation: "quote-html-parse",
        resultKind: result.kind,
        ...(result.kind === "success" ? {} : { code: result.code }),
        selectorContractVersion: 1,
        payloadFingerprint: dependencies.fingerprint.fingerprint(input.html),
      });
      return result;
    },
  };
}
