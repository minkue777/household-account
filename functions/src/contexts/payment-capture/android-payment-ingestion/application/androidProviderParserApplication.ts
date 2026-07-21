import type {
  AndroidProviderParseResult,
  ParseAndroidProviderNotificationInput,
} from "../domain/model/androidProviderParser";
import { findAndroidProviderParser } from "../domain/parsers/androidProviderParserCatalog";
import type { PaymentOccurrenceYearResolver } from "../domain/parsers/providerParsingSupport";
import { buildNotificationEnvelope } from "../domain/policies/buildNotificationEnvelope";
import type { AndroidProviderParserInputPort } from "./ports/in/androidProviderParserInputPort";

export interface AndroidProviderParserDependencies {
  readonly resolveOccurrenceYear: PaymentOccurrenceYearResolver;
}

class DefaultAndroidProviderParserApplication
  implements AndroidProviderParserInputPort
{
  constructor(private readonly dependencies: AndroidProviderParserDependencies) {}

  parse(
    input: ParseAndroidProviderNotificationInput,
  ): AndroidProviderParseResult {
    const parser = findAndroidProviderParser(input.source.parserId);
    if (parser === undefined) {
      return { kind: "Ignored", code: "UNSUPPORTED_PARSER" };
    }
    if (!parser.supportedPackages.includes(input.source.packageName)) {
      return { kind: "Ignored", code: "UNSUPPORTED_SOURCE" };
    }

    const envelope = buildNotificationEnvelope({
      packageName: input.source.packageName,
      postedAt: input.notification.postedAt ?? "",
      title: input.notification.title,
      text: input.notification.text,
      bigText: input.notification.bigText,
      textLines: input.notification.textLines,
    });
    if (envelope.kind === "Ignored") return envelope;

    return parser.parse({
      title: input.notification.title?.trim() ?? "",
      body: envelope.envelope.selectedBody,
      postedAt: input.notification.postedAt,
      clockNow: input.clockNow,
      resolveOccurrenceYear: this.dependencies.resolveOccurrenceYear,
    });
  }
}

export function createAndroidProviderParserApplication(
  dependencies: AndroidProviderParserDependencies,
): AndroidProviderParserInputPort {
  return new DefaultAndroidProviderParserApplication(dependencies);
}
