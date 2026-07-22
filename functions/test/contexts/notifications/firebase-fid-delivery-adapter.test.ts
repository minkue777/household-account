import type { Messaging } from "firebase-admin/messaging";
import { describe, expect, it, vi } from "vitest";

import { FirebaseFidDeliveryProvider } from "../../../src/adapters/firebase/notifications/firebaseNotificationDeliveryAdapters";

describe("Firebase FID 지출 알림 Adapter", () => {
  it("지출 식별자와 수정 링크를 background·foreground가 함께 소비할 payload로 전송한다", async () => {
    const send = vi.fn(async () => "provider-message-id");
    const provider = new FirebaseFidDeliveryProvider({ send } as unknown as Messaging);

    await expect(provider.sendOne({
      deliveryId: "delivery-1",
      endpointId: "endpoint-1",
      fid: "FID-1",
      payload: {
        payloadVersion: "notification-payload.v1",
        type: "household-notification-requested",
        clickTarget: "expense-edit",
        expenseId: "expense_A-1.2",
      },
    })).resolves.toEqual({ kind: "success" });

    const notificationData = {
      payloadVersion: "notification-payload.v1",
      type: "household-notification-requested",
      clickTarget: "expense-edit",
      expenseId: "expense_A-1.2",
      deliveryId: "delivery-1",
      endpointId: "endpoint-1",
    };
    expect(send).toHaveBeenCalledWith({
      fid: "FID-1",
      notification: {
        title: "가계부 알림",
        body: "새 지출 내역을 확인해 주세요.",
      },
      data: notificationData,
      webpush: {
        notification: {
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-72x72.png",
          data: notificationData,
        },
        fcmOptions: { link: "/?edit=expense_A-1.2" },
      },
    });
  });
});
