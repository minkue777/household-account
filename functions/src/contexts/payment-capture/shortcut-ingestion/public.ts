import { normalizeShortcutValue } from "./domain/policies/normalizeShortcutValue";
import type { ShortcutValueNormalizerInputPort } from "./application/ports/in/shortcutValueNormalizerInputPort";
import { createShortcutCardMessageParserApplication } from "./application/shortcutCardMessageParserApplication";
import type { ShortcutCardMessageParserInputPort } from "./application/ports/in/shortcutCardMessageParserInputPort";
import { createShortcutCredentialStorageInstallerApplication } from "./application/shortcutCredentialStorageInstallerApplication";
import type { ShortcutCredentialStorageInstallerInputPort } from "./application/ports/in/shortcutCredentialStorageInstallerInputPort";
import type { ShortcutCredentialLifecycleInputPort } from "./application/ports/in/shortcutCredentialLifecycleInputPort";
import { createShortcutInstallation } from "./domain/policies/createShortcutInstallation";

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

export type {
  ShortcutCredentialStorageAuthorizationResult,
  ShortcutCredentialStorageIssueResult,
  ShortcutCredentialStorageSession,
  ShortcutDefinition,
  ShortcutInstallation,
} from "./domain/model/shortcutCredentialStorageInstaller";

export type { ShortcutCredentialStorageInstallerInputPort } from "./application/ports/in/shortcutCredentialStorageInstallerInputPort";

export function createShortcutCredentialStorageInstaller<
  const Endpoint extends string,
>(
  lifecycle: ShortcutCredentialLifecycleInputPort,
  endpoint: Endpoint,
): ShortcutCredentialStorageInstallerInputPort<Endpoint> {
  return createShortcutCredentialStorageInstallerApplication({
    lifecycle,
    installation: createShortcutInstallation(endpoint),
  });
}
