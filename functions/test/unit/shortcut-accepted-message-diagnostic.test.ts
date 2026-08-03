import { describe, expect, it } from "vitest";

import { createShortcutHttpRequestProcessorApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutHttpRequestProcessorApplication";
import type { ShortcutMessageDiagnosticPort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";

describe("Shortcut parser 성공 원문 진단", () => {
  it("[T-IOS-DIAG-001][IOS-014] 인증된 원문을 intake와 병렬로 accepted 진단 저장한다", async () => {
    const retained: Array<
      Parameters<ShortcutMessageDiagnosticPort["retain"]>[0]
    > = [];
    let intakeStarted = false;
    let diagnosticStartedAfterIntake = false;
    const processor = createShortcutHttpRequestProcessorApplication({
      credentials: {
        async authorize() {
          return {
            kind: "authorized",
            credential: {
              credentialId: "credential-minji",
              actor: {
                principalUid: "uid-minji",
                householdId: "household-family",
                actingMemberId: "member-minji",
                capabilities: ["paymentCapture:submit"],
              },
            },
          } as const;
        },
      },
      credentialGate: {
        async evaluate() {
          return { kind: "allowed" } as const;
        },
      },
      parser: {
        parse() {
          return {
            kind: "Parsed",
            amountInWon: 6_480,
            occurredLocalDate: "2026-08-03",
            occurredLocalTime: "12:02",
            merchant: "허유재병원",
            cardEvidence: { companyLabel: "롯데", maskedToken: "5759" },
          } as const;
        },
      },
      intake: {
        async submit() {
          intakeStarted = true;
          await Promise.resolve();
          return {
            kind: "created",
            transactionId: "transaction-accepted",
          } as const;
        },
      },
      receipts: {
        async claim() {
          return { kind: "claimed" } as const;
        },
        async complete() {},
        async abandon() {},
        async waitForCompletion() {
          throw new Error("unexpected receipt wait");
        },
      },
      hashes: {
        hash(value) {
          return `hash(${value})`;
        },
      },
      messageDiagnostics: {
        async retain(input) {
          diagnosticStartedAfterIntake = intakeStarted;
          retained.push(input);
        },
      },
    });
    const rawMessage =
      "[Web발신]\r\n허유재병원\r\n6,480원 승인\r\n김*지 롯데5*5*";
    const normalizedMessage = rawMessage.trim();

    const result = await processor.process({
      bearerCredential: "raw-credential",
      diagnosticRawMessage: rawMessage,
      normalizedMessage,
      requestedAt: "2026-08-03T12:02:10+09:00",
      idempotencyKey: "accepted-lotte-message",
    });

    expect(result.kind).toBe("success");
    expect(diagnosticStartedAfterIntake).toBe(true);
    expect(retained).toEqual([
      expect.objectContaining({
        rawMessage,
        normalizedMessage,
        parserOutcome: { kind: "accepted" },
        credentialIdHash: "hash(credential-minji)",
        payloadHash: `hash(${normalizedMessage})`,
      }),
    ]);
  });

  it("성공 원문 저장 실패가 결제 성공을 실패로 바꾸지 않는다", async () => {
    const processor = createShortcutHttpRequestProcessorApplication({
      credentials: {
        async authorize() {
          return {
            kind: "authorized",
            credential: {
              credentialId: "credential-minji",
              actor: {
                principalUid: "uid-minji",
                householdId: "household-family",
                actingMemberId: "member-minji",
                capabilities: ["paymentCapture:submit"],
              },
            },
          } as const;
        },
      },
      credentialGate: {
        async evaluate() {
          return { kind: "allowed" } as const;
        },
      },
      parser: {
        parse() {
          return {
            kind: "Parsed",
            amountInWon: 500,
            occurredLocalDate: "2026-08-03",
            occurredLocalTime: "10:00",
            merchant: "테스트",
            cardEvidence: { companyLabel: "롯데" },
          } as const;
        },
      },
      intake: {
        async submit() {
          return { kind: "created", transactionId: "transaction-ok" } as const;
        },
      },
      receipts: {
        async claim() {
          return { kind: "claimed" } as const;
        },
        async complete() {},
        async abandon() {},
        async waitForCompletion() {
          throw new Error("unexpected receipt wait");
        },
      },
      hashes: { hash: (value) => `hash(${value})` },
      messageDiagnostics: {
        async retain() {
          throw new Error("diagnostic unavailable");
        },
      },
    });

    const result = await processor.process({
      bearerCredential: "raw-credential",
      diagnosticRawMessage: "raw",
      normalizedMessage: "normalized",
      requestedAt: "2026-08-03T10:00:00+09:00",
      idempotencyKey: "accepted-diagnostic-failure",
    });

    expect(result.kind).toBe("success");
  });
});
