import type { ShortcutPaymentResultV2 } from "../../domain/model/shortcutOutboxResponse";

export interface LegacyShortcutPaymentResponse {
  readonly success: boolean;
  readonly duplicate: boolean;
  readonly notificationSent: boolean;
  readonly targetOwner: string | null;
}

/**
 * 구형 HTTP 응답을 유지하는 동안만 사용하는 최외곽 호환 mapper입니다.
 * typed 결과나 Outbox를 변경하지 않습니다.
 */
export function mapLegacyShortcutPaymentResponse(
  result: ShortcutPaymentResultV2,
): LegacyShortcutPaymentResponse {
  return {
    success: result.transaction.kind !== "rejected",
    duplicate: result.transaction.kind === "duplicate",
    notificationSent: result.notification.state === "delivered",
    targetOwner: result.notification.targetMemberId ?? null,
  };
}
