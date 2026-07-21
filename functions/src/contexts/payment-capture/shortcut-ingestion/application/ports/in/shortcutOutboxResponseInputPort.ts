import type {
  ShortcutLedgerResult,
  ShortcutPaymentResultV2,
} from "../../../domain/model/shortcutOutboxResponse";

export interface ShortcutOutboxResponseInputPort {
  publish(input: {
    readonly commandId: string;
    readonly ledgerResult: ShortcutLedgerResult;
    readonly sourceEventId?: string;
  }): ShortcutPaymentResultV2;
}
