import { generateSmsCandidates } from "../domain/policies/generateSmsCandidates";
import { isSupportedSmsPackage } from "../domain/policies/supportedSmsPackage";
import type { AndroidSmsCandidateInputPort } from "./ports/in/androidSmsCandidateInputPort";
import type { NotificationIngressInputPort } from "./ports/in/notificationIngressInputPort";
import type { ParsedObservationClassificationInputPort } from "./ports/in/parsedObservationClassificationInputPort";
import type { SmsParserOrderInputPort } from "./ports/in/smsParserOrderInputPort";
import type { SmsCandidateParserCatalog } from "./ports/out/smsCandidateParserCatalog";

export interface AndroidSmsCandidateDependencies {
  readonly envelopes: Pick<NotificationIngressInputPort, "buildEnvelope">;
  readonly parserOrder: SmsParserOrderInputPort;
  readonly classification: ParsedObservationClassificationInputPort;
  readonly parsers: SmsCandidateParserCatalog;
}

export function createAndroidSmsCandidateApplication(
  dependencies: AndroidSmsCandidateDependencies,
): AndroidSmsCandidateInputPort {
  return {
    capture: (input) => {
      if (!isSupportedSmsPackage(input.packageName)) {
        return {
          kind: "Ignored",
          code: "UNSUPPORTED_SOURCE",
          candidates: [],
        };
      }

      const envelope = dependencies.envelopes.buildEnvelope(input);
      const candidates =
        envelope.kind === "Built"
          ? generateSmsCandidates(envelope.envelope.parseText)
          : [];

      for (const candidate of candidates) {
        const successes = dependencies.parsers.successfulParsers({
          body: candidate.body,
          postedAt: input.postedAt,
        });
        const ordered = dependencies.parserOrder.select({
          candidateId: String(candidate.ordinal),
          successfulParserIds: successes.map(
            (success) => success.orderParserId,
          ),
        });
        if (ordered.kind === "Unmatched") continue;

        const selected = successes.find(
          (success) => success.orderParserId === ordered.parserId,
        );
        if (selected === undefined) continue;

        const classification = dependencies.classification.classify({
          transactionCandidate: selected.transaction,
        });
        if (
          classification.kind !== "accepted" ||
          classification.envelope.paymentObservation === undefined
        ) {
          continue;
        }

        const payment = classification.envelope.paymentObservation;
        return {
          kind: "Parsed",
          selectedCandidate: candidate,
          parserId: selected.parserId,
          payment: {
            type: payment.observationType,
            amountInWon: payment.amountInWon,
            merchant: payment.merchantEvidence.rawCandidate,
          },
          candidates,
        };
      }

      return {
        kind: "Ignored",
        code: "NO_SUPPORTED_PAYMENT",
        candidates,
      };
    },
  };
}
