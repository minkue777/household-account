import type { CaptureSubmissionCommand } from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export function approvalCommand(input: {
  rootIdempotencyKey: string;
  originChannel: "android-notification" | "ios-shortcut";
  observationId?: string;
  amountInWon?: number;
  merchant?: string;
  card?: { companyLabel: string; maskedToken: string };
  balance?: {
    branchId: string;
    currencyType: "gyeonggi" | "daejeon" | "sejong";
    balanceInWon: number;
    observedAt: string;
  };
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
      observationId:
        input.observationId ?? `observation-${input.rootIdempotencyKey}`,
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
        branchId: `payment-${input.observationId ?? input.rootIdempotencyKey}`,
        observationType: "approval",
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

export function cancellationCommand(
  rootIdempotencyKey: string,
): CaptureSubmissionCommand {
  const command = approvalCommand({
    rootIdempotencyKey,
    originChannel: "android-notification",
  });
  const paymentObservation = command.envelope.paymentObservation;
  if (paymentObservation === undefined) {
    throw new Error("취소 명령에는 payment observation이 필요합니다.");
  }

  return {
    ...command,
    envelope: {
      ...command.envelope,
      paymentObservation: {
        ...paymentObservation,
        observationType: "cancellation",
      },
    },
  };
}

