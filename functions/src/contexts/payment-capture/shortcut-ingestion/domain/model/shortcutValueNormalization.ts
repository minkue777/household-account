export type ShortcutValueNormalizationResult =
  | { readonly kind: "Normalized"; readonly value: string }
  | { readonly kind: "Empty" };
