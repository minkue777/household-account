import { describe, expect, it } from "vitest";

import {
  createShortcutHttpInboundHandler,
  type ShortcutHttpInboundRequest,
} from "../../src/contexts/payment-capture/shortcut-ingestion/adapters/in/http/shortcutHttpInboundHandler";
import type { ShortcutHttpRequestProcessorInputPort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/in/shortcutHttpRequestProcessorInputPort";
import { createShortcutValueNormalizer } from "../../src/contexts/payment-capture/shortcut-ingestion/public";

describe("Shortcut HTTP 원문 진단 전달", () => {
  it("문자열 message를 trimming 또는 정규화하기 전 모습 그대로 processor에 전달한다", async () => {
    const rawMessage =
      " \r\n[Web발신]\u200B\r\n롯데 5*5*\r\n177,660원\r\n08/03 10:41 허유재병원 \t\r\n ";
    const processorInputs: Array<
      Parameters<ShortcutHttpRequestProcessorInputPort["process"]>[0]
    > = [];
    const processor: ShortcutHttpRequestProcessorInputPort = {
      async process(input) {
        processorInputs.push(input);
        return {
          kind: "error",
          code: "UNSUPPORTED_MESSAGE",
          retryable: false,
        };
      },
    };
    const handler = createShortcutHttpInboundHandler({
      limits: {
        maxBodyBytes: 2_048,
        maxMessageChars: 1_000,
        maxIdempotencyKeyChars: 100,
      },
      normalizer: createShortcutValueNormalizer(),
      processor,
      ingressGate: {
        async evaluateIp() {
          return { kind: "allowed" };
        },
      },
    });
    const request: ShortcutHttpInboundRequest = {
      method: "POST",
      headers: {
        authorization: "Bearer credential-minji",
        contentType: "application/json",
        idempotencyKey: " rejected-lotte-message ",
      },
      rawBodyBytes: Buffer.byteLength(rawMessage, "utf8"),
      body: {
        contractVersion: "shortcut-payment.v1",
        message: rawMessage,
      },
      receivedAt: "2026-08-03T10:42:00+09:00",
      remoteAddress: "203.0.113.10",
    };

    const response = await handler.handle(request);

    expect(response).toMatchObject({
      status: 422,
      body: { error: { code: "UNSUPPORTED_MESSAGE" } },
    });
    expect(processorInputs).toEqual([
      {
        bearerCredential: "credential-minji",
        diagnosticRawMessage: rawMessage,
        normalizedMessage:
          "[Web발신]\u200B\r\n롯데 5*5*\r\n177,660원\r\n08/03 10:41 허유재병원",
        requestedAt: "2026-08-03T10:42:00+09:00",
        idempotencyKey: "rejected-lotte-message",
      },
    ]);
  });
});
