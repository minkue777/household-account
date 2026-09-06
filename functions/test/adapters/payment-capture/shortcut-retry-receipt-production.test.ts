import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { FirebaseShortcutHttpReceiptAdapter, Sha256ShortcutHttpHashAdapter } from "../../../src/adapters/firebase/payment-capture/firebaseShortcutHttpInfrastructure";
import { createShortcutHttpRequestProcessorApplication } from "../../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutHttpRequestProcessorApplication";
import { createShortcutCardMessageParser } from "../../../src/contexts/payment-capture/shortcut-ingestion/public";
import type { ShortcutHttpPaymentIntakePort } from "../../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const message = "국민1234승인\n10,000원\n07/19 08:50 스타벅스";
function setup() {
  const memory = new InMemoryFirestore();
  const submit = vi.fn<ShortcutHttpPaymentIntakePort["submit"]>().mockResolvedValueOnce({ kind: "retryable-failure" }).mockResolvedValue({ kind: "created", transactionId: "transaction" });
  const retain = vi.fn().mockResolvedValue(undefined);
  const application = createShortcutHttpRequestProcessorApplication({
    credentials: { authorize: async () => ({ kind: "authorized", credential: { credentialId: "credential", actor: { principalUid: "uid", householdId: "house", actingMemberId: "member", capabilities: ["paymentCapture:submit"] } } }) },
    credentialGate: { evaluate: async () => ({ kind: "allowed" }) },
    receipts: new FirebaseShortcutHttpReceiptAdapter(memory as unknown as Firestore), hashes: new Sha256ShortcutHttpHashAdapter(),
    parser: createShortcutCardMessageParser(), intake: { submit }, messageDiagnostics: { retain },
  });
  const request = { bearerCredential: "credential", normalizedMessage: message, diagnosticRawMessage: message, requestedAt: "2026-07-19T00:00:00.000Z", idempotencyKey: "retry-key" };
  return { memory, application, request, submit, retain };
}

describe("[IOS-004][IOS-005] actual Shortcut parser and durable receipt replay", () => {
  it("retryable attempt preserves first receivedAt and parsed input across a later retry and returns the identical stored result", async () => {
    const subject = setup();
    expect(await subject.application.process(subject.request)).toMatchObject({ kind: "error", retryable: true });
    const result = await subject.application.process({ ...subject.request, requestedAt: "2027-01-01T00:00:00.000Z" });
    expect(result).toMatchObject({ kind: "success", transaction: { kind: "created", transactionId: "transaction" } });
    expect(subject.submit.mock.calls[0][0]).toEqual(subject.submit.mock.calls[1][0]);
    expect(await subject.application.process({ ...subject.request, requestedAt: "2027-01-02T00:00:00.000Z" })).toEqual(result);
    expect(subject.submit).toHaveBeenCalledTimes(2);
    expect(subject.retain).toHaveBeenCalledTimes(2);
  });

  it("[IOS-003] stable parser rejection and diagnostics are retained once; same-key retries never replace them", async () => {
    const subject = setup();
    const request = { ...subject.request, normalizedMessage: message.replace("국민", ""), diagnosticRawMessage: message.replace("국민", "") };
    const first = await subject.application.process(request);
    expect(first).toEqual({ kind: "error", code: "CARD_COMPANY_REQUIRED", retryable: false });
    expect(await subject.application.process({ ...request, requestedAt: "2026-07-20T00:00:00.000Z" })).toEqual(first);
    expect(subject.submit).not.toHaveBeenCalled();
    expect(subject.retain).toHaveBeenCalledTimes(1);
    expect(subject.retain.mock.calls[0][0].parserOutcome).toEqual({ kind: "rejected", code: "CARD_COMPANY_REQUIRED" });
    expect(await subject.application.process(subject.request)).toEqual({ kind: "error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH", retryable: false });
  });
});
