import { resolvePaymentOccurrenceYear } from "../../intake/public";
import type {
  ParseShortcutCardMessageInput,
  ShortcutCardMessageParseResult,
} from "../domain/model/shortcutCardMessage";
import { parseShortcutCardMessage } from "../domain/policies/parseShortcutCardMessage";
import type { ShortcutCardMessageParserInputPort } from "./ports/in/shortcutCardMessageParserInputPort";

class DefaultShortcutCardMessageParserApplication
  implements ShortcutCardMessageParserInputPort
{
  parse(
    input: ParseShortcutCardMessageInput,
  ): ShortcutCardMessageParseResult {
    return parseShortcutCardMessage({
      command: input,
      resolveOccurrenceYear: resolvePaymentOccurrenceYear,
    });
  }
}

export function createShortcutCardMessageParserApplication(): ShortcutCardMessageParserInputPort {
  return new DefaultShortcutCardMessageParserApplication();
}
