import type {
  AndroidProviderParseResult,
  ParseAndroidProviderNotificationInput,
} from "../../../domain/model/androidProviderParser";

export interface AndroidProviderParserInputPort {
  parse(
    input: ParseAndroidProviderNotificationInput,
  ): AndroidProviderParseResult;
}
