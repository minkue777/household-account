import type { LegacyShortcutCardTypeCharacterization } from "../model/shortcutPaymentRecording";

export function characterizeLegacyShortcutCardType(input: {
  readonly companyLabel: string;
  readonly maskedToken?: string;
}): LegacyShortcutCardTypeCharacterization {
  const digits = input.maskedToken?.replace(/\D/g, "") ?? "";
  const isLegacySamsung1876 =
    input.companyLabel.trim() === "삼성" && digits.slice(-4) === "1876";

  return {
    kind: "LegacyOnly",
    cardType: isLegacySamsung1876 ? "legacy-samsung-1876" : null,
  };
}
