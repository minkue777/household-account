import { describe, expect, it, vi } from "vitest";

import { FirebaseShortcutRejectedMessageDiagnosticAdapter } from "../../src/adapters/firebase/payment-capture/firebaseShortcutRejectedMessageDiagnostic";

describe("FirebaseShortcutRejectedMessageDiagnosticAdapter", () => {
  it("인증된 iPhone parser 거부 원문을 관리자 전용 진단 문서로 보존한다", async () => {
    const set = vi.fn(async () => undefined);
    const doc = vi.fn(() => ({ set }));
    const collection = vi.fn(() => ({ doc }));
    const adapter = new FirebaseShortcutRejectedMessageDiagnosticAdapter({
      collection,
    } as never);
    const rawMessage =
      "[Web발신]\r허유재병원\u2028177,660원 승인\n김*지 롯데5*5*";

    await adapter.retain({
      actor: {
        principalUid: "principal-minji",
        householdId: "household-minji",
        actingMemberId: "member-minji",
        capabilities: ["paymentCapture:submit"],
      },
      credentialIdHash: "credential-hash",
      payloadHash: "payload-hash",
      rawMessage,
      normalizedMessage: rawMessage.trim(),
      rejectionCode: "UNSUPPORTED_MESSAGE",
      requestedAt: "2026-08-03T01:42:02.614Z",
    });

    expect(collection).toHaveBeenCalledWith("notification_debug_logs");
    expect(doc).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/u));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosticType: "ios-shortcut-parser-rejection",
        householdId: "household-minji",
        memberId: "member-minji",
        sourceType: "ios-shortcut",
        fullText: rawMessage,
        normalizedText: rawMessage.trim(),
        parserRejectionCode: "UNSUPPORTED_MESSAGE",
        credentialIdHash: "sha256:credential-hash",
        payloadHash: "sha256:payload-hash",
        textLines: [
          "[Web발신]",
          "허유재병원",
          "177,660원 승인",
          "김*지 롯데5*5*",
        ],
      }),
      { merge: true },
    );
  });

  it("같은 credential과 payload는 동일 진단 문서 ID를 사용한다", async () => {
    const ids: string[] = [];
    const adapter = new FirebaseShortcutRejectedMessageDiagnosticAdapter({
      collection: () => ({
        doc: (id: string) => {
          ids.push(id);
          return { set: async () => undefined };
        },
      }),
    } as never);
    const input = {
      actor: {
        principalUid: "principal-minji",
        householdId: "household-minji",
        actingMemberId: "member-minji",
        capabilities: ["paymentCapture:submit"] as const,
      },
      credentialIdHash: "credential-hash",
      payloadHash: "payload-hash",
      rawMessage: "지원하지 않는 원문",
      normalizedMessage: "지원하지 않는 원문",
      rejectionCode: "UNSUPPORTED_MESSAGE" as const,
      requestedAt: "2026-08-03T01:42:02.614Z",
    };

    await adapter.retain(input);
    await adapter.retain(input);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
});
