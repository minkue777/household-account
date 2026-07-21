import type { ShortcutHttpRequestProcessingResult } from "../../../domain/model/shortcutHttpInbound";

export interface ShortcutHttpRequestProcessorInputPort {
  process(input: {
    readonly bearerCredential: string | null;
    readonly normalizedMessage: string;
    readonly requestedAt: string;
    readonly idempotencyKey?: string;
  }): Promise<ShortcutHttpRequestProcessingResult>;
}
