import type {
  SecureBridgeOperation,
  SecureWebViewBridgeInputPort,
  SecureWebViewBridgeState,
} from "./ports/in/secureWebViewBridgeInputPort";

export interface SecureWebViewBridgeApplicationOptions {
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
}

const canonicalOrigin = (value: string): string | undefined => {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export function createSecureWebViewBridgeApplication(
  options: SecureWebViewBridgeApplicationOptions,
): SecureWebViewBridgeInputPort {
  const allowedOrigins = new Set(
    options.allowedOrigins
      .map(canonicalOrigin)
      .filter((origin): origin is string => origin !== undefined),
  );
  const handles = new Map(
    (options.exchangeHandles ?? []).map((handle) => [handle.handle, { ...handle }]),
  );
  const receipts = new Map(
    (options.membershipReceipts ?? []).map((receipt) => [
      receipt.receiptId,
      { ...receipt },
    ]),
  );
  const usedHandles = new Set<string>();
  const usedReceipts = new Set<string>();
  const acceptedSensitiveOperations: SecureBridgeOperation[] = [];
  const establishedPrincipalRefs: string[] = [];
  let sessionMirror: SecureWebViewBridgeState["sessionMirror"];

  const originIsAllowed = (documentUrl: string): boolean => {
    const origin = canonicalOrigin(documentUrl);
    return origin !== undefined && allowedOrigins.has(origin);
  };

  return {
    execute(input) {
      const reject = (
        code:
          | "ORIGIN_NOT_ALLOWED"
          | "TOP_LEVEL_REQUIRED"
          | "VERSION_UNSUPPORTED"
          | "MEMBERSHIP_RECEIPT_REQUIRED"
          | "MEMBERSHIP_RECEIPT_INVALID"
          | "MEMBERSHIP_RECEIPT_ALREADY_USED",
      ) => ({ kind: "Rejected" as const, requestId: input.requestId, code });

      if (!originIsAllowed(input.topLevelDocumentUrl)) {
        return reject("ORIGIN_NOT_ALLOWED");
      }
      if (input.frame !== "top-level") return reject("TOP_LEVEL_REQUIRED");
      if (input.contractVersion !== "v1") return reject("VERSION_UNSUPPORTED");

      if (input.operation === "SYNC_SESSION_MIRROR") {
        if (input.membershipReceiptId === undefined) {
          return reject("MEMBERSHIP_RECEIPT_REQUIRED");
        }
        if (usedReceipts.has(input.membershipReceiptId)) {
          return reject("MEMBERSHIP_RECEIPT_ALREADY_USED");
        }

        const receipt = receipts.get(input.membershipReceiptId);
        if (
          receipt === undefined ||
          input.at === undefined ||
          Date.parse(input.at) >= Date.parse(receipt.expiresAt)
        ) {
          return reject("MEMBERSHIP_RECEIPT_INVALID");
        }

        usedReceipts.add(receipt.receiptId);
        sessionMirror = {
          principalRef: receipt.principalRef,
          householdId: receipt.householdId,
          memberId: receipt.memberId,
        };
      }

      acceptedSensitiveOperations.push(input.operation);
      return { kind: "Success", requestId: input.requestId };
    },

    exchangeSession(input) {
      if (!originIsAllowed(input.topLevelDocumentUrl)) {
        return { kind: "Rejected", code: "ORIGIN_NOT_ALLOWED" };
      }
      if (usedHandles.has(input.handle)) {
        return { kind: "Rejected", code: "ALREADY_USED" };
      }

      const handle = handles.get(input.handle);
      if (
        handle === undefined ||
        Date.parse(input.at) >= Date.parse(handle.expiresAt)
      ) {
        return { kind: "Rejected", code: "EXPIRED" };
      }

      usedHandles.add(handle.handle);
      if (!establishedPrincipalRefs.includes(handle.principalRef)) {
        establishedPrincipalRefs.push(handle.principalRef);
      }
      return {
        kind: "SessionEstablished",
        principalRef: handle.principalRef,
      };
    },

    state(): SecureWebViewBridgeState {
      return {
        acceptedSensitiveOperations: [...acceptedSensitiveOperations],
        sessionMirror:
          sessionMirror === undefined ? undefined : { ...sessionMirror },
        establishedPrincipalRefs: [...establishedPrincipalRefs],
        exposedCredentialValues: [],
      };
    },
  };
}
