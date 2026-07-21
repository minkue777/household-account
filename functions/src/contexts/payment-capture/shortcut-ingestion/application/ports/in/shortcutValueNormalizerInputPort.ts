import type { ShortcutValueNormalizationResult } from "../../../domain/model/shortcutValueNormalization";

export interface ShortcutValueNormalizerInputPort {
  normalize(value: unknown): ShortcutValueNormalizationResult;
}

export type { ShortcutValueNormalizationResult };
