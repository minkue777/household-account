import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CaptureMembershipResolver } from "../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import {
  CaptureCallableRejection,
  correlationIdForAndroidRawNotificationRequest,
  createAndroidRawNotificationCallableHandler,
} from "../../src/bootstrap/firebaseCaptureSubmission";
import type { AndroidRawNotificationSubmissionInputPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/androidRawNotificationSubmissionInputPort";
import {
  setCurrentInteractiveLatencyOperation,
  startInteractiveLatencyInvocation,
  type InteractiveLatencyLogEntry,
} from "../../src/observability/interactiveLatency";

function membership(): CaptureMembershipResolver {
  return {
    resolve: async (principalUid) =>
      principalUid === undefined
        ? { kind: "unauthenticated", code: "AUTH_REQUIRED" }
        : {
            kind: "active",
            principalUid,
            householdId: "server-household",
            memberId: "server-member",
          },
  };
}

function raw() {
  return {
    contractVersion: "android-raw-notification.v1",
    observationId: "observation.android.wire-1",
    packageName: "com.samsung.android.messaging",
    notification: {
      postedAt: "2026-07-22T17:41:00+09:00",
      text: "삼성1876승인 20,300원",
    },
  };
}

describe("submitAndroidRawNotification callable wire", () => {
  it("인증 membership에서만 서버가 결정한 actor로 원문 애플리케이션을 호출한다", async () => {
    let captured: Parameters<AndroidRawNotificationSubmissionInputPort["submit"]>[0] | undefined;
    const handler = createAndroidRawNotificationCallableHandler({
      memberships: membership(),
      submissions: {
        submit: async (command) => {
          captured = command;
          return {
            kind: "success",
            value: {
              observationId: command.input.observationId,
              completion: "terminal",
            },
          };
        },
      },
    });

    await expect(
      handler.handle({ principalUid: "firebase-uid", data: raw() }),
    ).resolves.toEqual({
      contractVersion: "capture-submission-response.v1",
      result: {
        observationId: "observation.android.wire-1",
        completion: "terminal",
      },
    });
    expect(captured).toMatchObject({
      actor: {
        principalId: "firebase-uid",
        householdId: "server-household",
        actingMemberId: "server-member",
        capabilities: ["paymentCapture:submit"],
      },
    });
  });

  it("membership과 handler 지연을 raw notification correlation으로 계측한다", async () => {
    const entries: InteractiveLatencyLogEntry[] = [];
    const correlationId =
      correlationIdForAndroidRawNotificationRequest(raw());
    const latency = startInteractiveLatencyInvocation(
      "submitAndroidRawNotification",
      {
        correlationId,
        sink: { write: (entry) => entries.push(entry) },
      },
    );
    const handler = createAndroidRawNotificationCallableHandler({
      memberships: membership(),
      submissions: {
        submit: async (command) => ({
          kind: "success",
          value: {
            observationId: command.input.observationId,
            completion: "terminal",
          },
        }),
      },
    });

    await latency.run(async () => {
      setCurrentInteractiveLatencyOperation(
        "payment-capture.submit-android-raw-notification.v1",
      );
      await handler.handle({ principalUid: "firebase-uid", data: raw() });
      latency.complete("succeeded");
    });

    expect(entries.map((entry) => entry.stage)).toEqual([
      "capture-membership",
      "handler",
      "total",
    ]);
    expect(
      new Set(entries.map((entry) => entry.correlationId)),
    ).toEqual(new Set([correlationId]));
    expect(correlationId).toBe(
      createHash("sha256")
        .update(raw().observationId, "utf8")
        .digest("hex")
        .slice(0, 16),
    );
    expect(JSON.stringify(entries)).not.toContain(raw().observationId);
  });

  it("검증 가능한 opaque observationId만 correlation hash로 사용한다", () => {
    expect(
      correlationIdForAndroidRawNotificationRequest({
        observationId: "observation.android.valid-1",
      }),
    ).toMatch(/^[a-f0-9]{16}$/u);
    expect(
      correlationIdForAndroidRawNotificationRequest({
        observationId: "사용자 이름이 포함된 값",
      }),
    ).toBeUndefined();
    expect(
      correlationIdForAndroidRawNotificationRequest({
        observationId: "x".repeat(129),
      }),
    ).toBeUndefined();
  });

  it("비인증 요청은 payload를 해석하기 전에 거부한다", async () => {
    let decoded = false;
    const handler = createAndroidRawNotificationCallableHandler({
      memberships: membership(),
      submissions: { submit: async () => { throw new Error("호출되면 안 됩니다"); } },
      decode: () => {
        decoded = true;
        throw new Error("호출되면 안 됩니다");
      },
    });

    await expect(handler.handle({ data: {} })).rejects.toBeInstanceOf(
      CaptureCallableRejection,
    );
    expect(decoded).toBe(false);
  });

  it("strict raw 계약 오류를 invalid-argument로 반환한다", async () => {
    const handler = createAndroidRawNotificationCallableHandler({
      memberships: membership(),
      submissions: { submit: async () => { throw new Error("호출되면 안 됩니다"); } },
    });

    await expect(
      handler.handle({
        principalUid: "firebase-uid",
        data: { ...raw(), parserId: "client-parser" },
      }),
    ).rejects.toMatchObject({
      callableCode: "invalid-argument",
      domainCode: "UNKNOWN_FIELD",
      details: { path: "$.parserId" },
    });
  });
});
