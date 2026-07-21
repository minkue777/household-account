import type {
  ParseShortcutCardMessageInput,
  ShortcutCardMessageParseResult,
} from "../../../domain/model/shortcutCardMessage";

export interface ShortcutCardMessageParserInputPort {
  parse(
    input: ParseShortcutCardMessageInput,
  ): ShortcutCardMessageParseResult;
}
