import { createSecureWebViewBridgeApplication } from "../reference/android-host/application/secureWebViewBridgeApplication";

export function createSecureWebViewBridgeFixture(fixture: {
  readonly allowedOrigins: readonly string[];
  readonly exchangeHandles?: readonly {
    readonly handle: string;
    readonly principalRef: string;
    readonly expiresAt: string;
  }[];
  readonly membershipReceipts?: readonly {
    readonly receiptId: string;
    readonly principalRef: string;
    readonly householdId: string;
    readonly memberId: string;
    readonly expiresAt: string;
  }[];
}) {
  return createSecureWebViewBridgeApplication(fixture);
}
