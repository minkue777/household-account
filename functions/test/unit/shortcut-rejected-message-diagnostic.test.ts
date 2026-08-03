import { describe, expect, it } from "vitest";

import {
  createShortcutHttpRequestProcessorApplication,
  type ShortcutHttpRequestProcessorDependencies,
} from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutHttpRequestProcessorApplication";
import type { ShortcutMessageDiagnosticPort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";
import type { ShortcutHttpRequestProcessingResult } from "../../src/contexts/payment-capture/shortcut-ingestion/public";

const actor = {
  principalUid: "uid-minji",
  householdId: "household-family",
  actingMemberId: "member-minji",
  capabilities: ["paymentCapture:submit"],
} as const;

const processorInput = {
  bearerCredential: "raw-credential-must-not-be-retained",
  diagnosticRawMessage:
    " \r\n[Web발신]\u200B\r\n롯데 5*5*\r\n177,660원\r\n08/03 10:41 허유재병원 \r\n ",
  normalizedMessage:
    "[Web발신]\u200B\r\n롯데 5*5*\r\n177,660원\r\n08/03 10:41 허유재병원",
  requestedAt: "2026-08-03T10:42:00+09:00",
  idempotencyKey: "rejected-lotte-message",
} as const;

function createRejectedMessageSubject(options: {
  readonly diagnostics: "success" | "failure" | "absent";
}) {
  const retained: Array<
    Parameters<ShortcutMessageDiagnosticPort["retain"]>[0]
  > = [];
  const completed: Array<{
    readonly receiptKey: string;
    readonly result: ShortcutHttpRequestProcessingResult;
  }> = [];
  const abandoned: string[] = [];
  const intakeSubmissions: unknown[] = [];

  const messageDiagnostics: ShortcutMessageDiagnosticPort = {
    async retain(input) {
      retained.push(input);
      if (options.diagnostics === "failure") {
        throw new Error("diagnostic store unavailable");
      }
    },
  };
  const dependencies: ShortcutHttpRequestProcessorDependencies = {
    credentials: {
      async authorize() {
        return {
          kind: "authorized",
          credential: { credentialId: "credential-minji", actor },
        };
      },
    },
    credentialGate: {
      async evaluate() {
        return { kind: "allowed" };
      },
    },
    parser: {
      parse() {
        return { kind: "Rejected", code: "UNSUPPORTED_CARD_COMPANY" };
      },
    },
    intake: {
      async submit(input) {
        intakeSubmissions.push(input);
        return { kind: "retryable-failure" };
      },
    },
    receipts: {
      async claim() {
        return { kind: "claimed" };
      },
      async complete(input) {
        completed.push(input);
      },
      async abandon(input) {
        abandoned.push(input.receiptKey);
      },
      async waitForCompletion() {
        throw new Error("unexpected receipt wait");
      },
    },
    hashes: {
      hash(value) {
        return `hash(${value})`;
      },
    },
    ...(options.diagnostics === "absent"
      ? {}
      : { messageDiagnostics }),
  };

  return {
    processor: createShortcutHttpRequestProcessorApplication(dependencies),
    retained,
    completed,
    abandoned,
    intakeSubmissions,
  };
}

describe("Shortcut parser 거부 원문 진단", () => {
  it("[T-IOS-DIAG-001][IOS-014] 인증된 actor와 해시, 원문, 정규화문, parser 거부 코드를 진단 port로 전달한다", async () => {
    const subject = createRejectedMessageSubject({ diagnostics: "success" });

    const result = await subject.processor.process(processorInput);

    expect(result).toEqual({
      kind: "error",
      code: "UNSUPPORTED_MESSAGE",
      retryable: false,
    });
    expect(subject.retained).toEqual([
      {
        actor,
        credentialIdHash: "hash(credential-minji)",
        payloadHash: `hash(${processorInput.normalizedMessage})`,
        rawMessage: processorInput.diagnosticRawMessage,
        normalizedMessage: processorInput.normalizedMessage,
        parserOutcome: {
          kind: "rejected",
          code: "UNSUPPORTED_CARD_COMPANY",
        },
        requestedAt: processorInput.requestedAt,
      },
    ]);
    expect(subject.intakeSubmissions).toEqual([]);
    expect(subject.completed).toEqual([
      {
        receiptKey: "credential-minji:provided:rejected-lotte-message",
        result,
      },
    ]);
  });

  it("진단 port 저장 실패가 UNSUPPORTED_MESSAGE 응답과 완료 receipt를 깨지 않는다", async () => {
    const subject = createRejectedMessageSubject({ diagnostics: "failure" });

    const result = await subject.processor.process(processorInput);

    expect(result).toEqual({
      kind: "error",
      code: "UNSUPPORTED_MESSAGE",
      retryable: false,
    });
    expect(subject.retained).toHaveLength(1);
    expect(subject.completed).toEqual([
      {
        receiptKey: "credential-minji:provided:rejected-lotte-message",
        result,
      },
    ]);
    expect(subject.abandoned).toEqual([]);
    expect(subject.intakeSubmissions).toEqual([]);
  });

  it("진단 port가 구성되지 않아도 기존 parser 거부 응답과 receipt를 유지한다", async () => {
    const subject = createRejectedMessageSubject({ diagnostics: "absent" });

    const result = await subject.processor.process(processorInput);

    expect(result).toEqual({
      kind: "error",
      code: "UNSUPPORTED_MESSAGE",
      retryable: false,
    });
    expect(subject.retained).toEqual([]);
    expect(subject.completed).toHaveLength(1);
    expect(subject.abandoned).toEqual([]);
  });
});
