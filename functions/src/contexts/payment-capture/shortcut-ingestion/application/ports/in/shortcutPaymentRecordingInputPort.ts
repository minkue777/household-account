import type {
  LegacyShortcutCardTypeCharacterization,
  ShortcutPaymentRecordingCommand,
  ShortcutPaymentRecordingResult,
} from "../../../domain/model/shortcutPaymentRecording";

export interface ShortcutPaymentRecordingInputPort {
  record(
    command: ShortcutPaymentRecordingCommand,
  ): Promise<ShortcutPaymentRecordingResult>;

  characterizeLegacyCardType(input: {
    readonly companyLabel: string;
    readonly maskedToken?: string;
  }): LegacyShortcutCardTypeCharacterization;
}
