import { normalizeShortcutValue } from "./domain/policies/normalizeShortcutValue";
import type { ShortcutValueNormalizerInputPort } from "./application/ports/in/shortcutValueNormalizerInputPort";
import { createShortcutCardMessageParserApplication } from "./application/shortcutCardMessageParserApplication";
import type { ShortcutCardMessageParserInputPort } from "./application/ports/in/shortcutCardMessageParserInputPort";

export type {
  ShortcutValueNormalizationResult,
  ShortcutValueNormalizerInputPort,
} from "./application/ports/in/shortcutValueNormalizerInputPort";

export function createShortcutValueNormalizer(): ShortcutValueNormalizerInputPort {
  return { normalize: normalizeShortcutValue };
}

export type {
  ParseShortcutCardMessageInput,
  ShortcutCardMessageParseResult,
} from "./domain/model/shortcutCardMessage";

export type { ShortcutCardMessageParserInputPort } from "./application/ports/in/shortcutCardMessageParserInputPort";

export function createShortcutCardMessageParser(): ShortcutCardMessageParserInputPort {
  return createShortcutCardMessageParserApplication();
}

export type {
  IssueShortcutCredentialResult,
  RevokeShortcutCredentialResult,
  ShortcutCredentialActor,
  ShortcutCredentialAuthorizationResult,
  ShortcutCredentialSession,
  ShortcutCredentialStatusResult,
} from "./domain/model/shortcutCredentialLifecycle";

export type { ShortcutCredentialLifecycleInputPort } from "./application/ports/in/shortcutCredentialLifecycleInputPort";

export type {
  ShortcutHttpAuthorizationDecision,
  ShortcutHttpAuthorizedCredential,
  ShortcutHttpPaymentIntakeResult,
  ShortcutHttpProcessingErrorCode,
  ShortcutHttpRequestProcessingResult,
} from "./domain/model/shortcutHttpInbound";

export type { ShortcutHttpRequestProcessorInputPort } from "./application/ports/in/shortcutHttpRequestProcessorInputPort";
