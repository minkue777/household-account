import type {
  CaptureBalanceObservation,
  CaptureOriginChannel,
  CapturePaymentObservation,
  CaptureSubmissionCommand,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export function paymentCommand(input: {
  rootIdempotencyKey: string;
  originChannel: CaptureOriginChannel;
  observationType?: CapturePaymentObservation["observationType"];
  amountInWon?: number;
  merchant?: string;
  card?: CapturePaymentObservation["cardEvidence"];
  balance?: CaptureBalanceObservation;
}): CaptureSubmissionCommand {
  return {
    actor: {
      principalId: "principal-1",
      householdId: "household-1",
      actingMemberId: "member-1",
      capabilities: ["paymentCapture:submit"],
    },
    rootIdempotencyKey: input.rootIdempotencyKey,
    envelope: {
      contractVersion: "capture-envelope.v1",
      observationId: `observation-${input.rootIdempotencyKey}`,
      originChannel: input.originChannel,
      sourceEvidence:
        input.originChannel === "android-notification"
          ? {
              kind: "android-registered-package",
              sourceType: "kb-card",
              packageName: "com.kbcard.cxh.appcard",
              registryVersion: "source-registry.v1",
            }
          : {
              kind: "ios-shortcut-credential",
              sourceType: "ios-shortcut",
              credentialIdHash:
                "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            },
      observedAt: "2026-07-19T10:05:01+09:00",
      parser: {
        parserId:
          input.originChannel === "android-notification"
            ? "kb-parser"
            : "shortcut-parser",
        parserVersion: "1",
      },
      rawPayloadHash:
        "sha256:6666666666666666666666666666666666666666666666666666666666666666",
      paymentObservation: {
        branchId: `payment-${input.rootIdempotencyKey}`,
        observationType: input.observationType ?? "approval",
        amountInWon: input.amountInWon ?? 12_000,
        occurredLocalDate: "2026-07-19",
        occurredLocalTime: "10:05",
        zoneId: "Asia/Seoul",
        merchantEvidence: { rawCandidate: input.merchant ?? "가맹점 A" },
        cardEvidence: input.card ?? {
          companyLabel: "국민",
          maskedToken: "1234",
        },
      },
      ...(input.balance === undefined
        ? {}
        : { balanceObservation: input.balance }),
    },
  };
}

