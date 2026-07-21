import type { ShortcutPaymentResultV2 } from "../../../domain/model/shortcutOutboxResponse";

export type CommitShortcutOutboxResponseResult =
  | { readonly kind: "Committed" }
  | {
      readonly kind: "AlreadyCommitted";
      readonly result: ShortcutPaymentResultV2;
    };

/** HTTP 응답 receipt와 이미 존재하는 source event 소비 표식만 기록합니다. */
export interface ShortcutOutboxResponseStorePort {
  findByCommandId(commandId: string): ShortcutPaymentResultV2 | undefined;
  commitOnce(input: {
    readonly commandId: string;
    readonly result: ShortcutPaymentResultV2;
    readonly consumedSourceEventId?: string;
  }): CommitShortcutOutboxResponseResult;
}
