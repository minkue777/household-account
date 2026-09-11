import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  FirebaseCaptureSubmissionReceiptStore,
  Sha256CapturePayloadFingerprint,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import type { CaptureBranchEnvelope } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/captureBranchSubmissionInputPort";
import type { CaptureSubmissionReceipt } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureSubmissionReceiptPort";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function envelope(): CaptureBranchEnvelope {
  return {
    householdId: "house-1",
    rootIdempotencyKey: "observation-1",
    captureEnvelopeIdentity: {
      contractVersion: "capture-envelope.v1",
      observationId: "observation-1",
      originChannel: "android-notification",
      sourceIdentity: "registered:kb-card",
      observedAt: "2026-07-21T10:05:01+09:00",
      parserId: "kb-card-parser",
      parserVersion: "2.0.0",
      rawPayloadHash:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    },
    transactionBranch: {
      branchKey: "payment-1",
      merchant: "가맹점 A",
      amountInWon: 12_000,
      occurredAt: "2026-07-21T10:05:00+09:00",
      accountingDate: "2026-07-21",
      sourceType: "kb-card",
      parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
      rawPayloadHash:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      captureContext: {
        observationId: "observation-1",
        observationType: "approval",
        originChannel: "android-notification",
        creatorMemberId: "member-1",
        cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
      },
    },
  };
}

describe("Firebase Capture root receipt adapter", () => {
  it("서버에서 결박한 같은 원문은 parser 결과 변경 뒤에도 종단 receipt를 재생하고 다른 원문은 거절한다", async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebaseCaptureSubmissionReceiptStore(memory as unknown as firestore.Firestore);
    const payloads = new Sha256CapturePayloadFingerprint();
    const base = envelope();
    const input = { ...base, verifiedRawInput: { creatorMemberId: "member-1", payloadHash: base.captureEnvelopeIdentity!.rawPayloadHash } };
    const claim = await store.claim({ envelope: input, payloadFingerprint: payloads.fingerprint(input) });
    if (claim.kind !== "claimed") throw new Error("First receipt required");
    const saved = await store.save({ ...claim.receipt, state: "completed", transaction: {
      stage: "terminal", downstreamKey: "payment-1", result: { kind: "recorded", transactionId: "transaction-1",
        editable: true, captureLineageId: "lineage-1", aggregateVersion: 1 },
    } });
    const reparsed = { ...input, captureEnvelopeIdentity: { ...input.captureEnvelopeIdentity!, parserVersion: "3.0.0" },
      transactionBranch: { ...input.transactionBranch!, parser: { parserId: "new-parser", parserVersion: "3.0.0" },
        merchant: "새 파싱 결과", amountInWon: 1000 } };
    expect(await store.claim({ envelope: reparsed, payloadFingerprint: payloads.fingerprint(reparsed) }))
      .toEqual({ kind: "existing", receipt: saved });
    const different = { ...reparsed, verifiedRawInput: { ...input.verifiedRawInput, payloadHash: `sha256:${"9".repeat(64)}` } };
    expect(await store.claim({ envelope: different, payloadFingerprint: payloads.fingerprint(different) }))
      .toEqual({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(memory.paths("households/house-1/captureSubmissionReceipts/")).toHaveLength(1);
  });

  it("기존 typed fingerprint receipt는 같은 원문을 서버 검증 metadata와 함께 재시도해도 계속 읽는다", async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebaseCaptureSubmissionReceiptStore(memory as unknown as firestore.Firestore);
    const payloads = new Sha256CapturePayloadFingerprint();
    const input = envelope();
    const first = await store.claim({ envelope: input, payloadFingerprint: payloads.fingerprint(input) });
    if (first.kind !== "claimed") throw new Error("Legacy receipt required");
    const upgraded = { ...input, verifiedRawInput: { creatorMemberId: "member-1", payloadHash: input.captureEnvelopeIdentity!.rawPayloadHash } };
    expect(await store.claim({ envelope: upgraded, payloadFingerprint: payloads.fingerprint(upgraded) }))
      .toEqual({ kind: "existing", receipt: first.receipt });
    const different = { ...upgraded, captureEnvelopeIdentity: { ...input.captureEnvelopeIdentity!, rawPayloadHash: `sha256:${"9".repeat(64)}` },
      verifiedRawInput: { ...upgraded.verifiedRawInput, payloadHash: `sha256:${"9".repeat(64)}` } };
    expect(await store.claim({ envelope: different, payloadFingerprint: payloads.fingerprint(different) }))
      .toEqual({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });

  it("내부 card/bill discriminator를 payload fingerprint에서 구분한다", () => {
    const payloads = new Sha256CapturePayloadFingerprint();
    const input = envelope();
    const withKind = (
      paymentKind: "card" | "bill",
    ): CaptureBranchEnvelope => ({
      ...input,
      transactionBranch: {
        ...input.transactionBranch!,
        captureContext: {
          ...input.transactionBranch!.captureContext!,
          paymentKind,
        },
      },
    });

    expect(payloads.fingerprint(withKind("card"))).not.toBe(
      payloads.fingerprint(input),
    );
    expect(payloads.fingerprint(withKind("bill"))).not.toBe(
      payloads.fingerprint(withKind("card")),
    );
  });

  it("동일 root·payload는 branch 종단 결과를 재생하고 payload 변경은 충돌시킨다", async () => {
    const memory = new InMemoryFirestore();
    const store = new FirebaseCaptureSubmissionReceiptStore(
      memory as unknown as firestore.Firestore,
      () => "2026-07-21T10:06:00+09:00",
    );
    const payloads = new Sha256CapturePayloadFingerprint();
    const input = envelope();
    const fingerprint = payloads.fingerprint(input);

    const first = await store.claim({
      envelope: input,
      payloadFingerprint: fingerprint,
    });
    expect(first).toMatchObject({
      kind: "claimed",
      receipt: {
        state: "claimed",
        transaction: { stage: "pending", downstreamKey: "payment-1" },
        balance: { stage: "absent" },
      },
    });
    if (first.kind !== "claimed") return;
    await store.save({
      ...first.receipt,
      state: "completed",
      transaction: {
        stage: "terminal",
        downstreamKey: "payment-1",
        result: {
          kind: "recorded",
          transactionId: "transaction-1",
          editable: true,
          captureLineageId: "lineage-1",
          aggregateVersion: 1,
          quickEditSnapshot: {
            transactionId: "transaction-1",
            merchant: "가맹점 A",
            amountInWon: 12_000,
            accountingDate: "2026-07-21",
            localTime: "10:05",
            categoryId: "etc",
            memo: "",
            aggregateVersion: 1,
          },
        },
      },
    });

    expect(
      await store.claim({ envelope: input, payloadFingerprint: fingerprint }),
    ).toMatchObject({
      kind: "existing",
      receipt: {
        state: "completed",
        transaction: {
          stage: "terminal",
          result: { kind: "recorded", aggregateVersion: 1 },
        },
      },
    });
    expect(
      await store.claim({
        envelope: { ...input, transactionBranch: { ...input.transactionBranch!, amountInWon: 12_001 } },
        payloadFingerprint: payloads.fingerprint({
          ...input,
          transactionBranch: { ...input.transactionBranch!, amountInWon: 12_001 },
        }),
      }),
    ).toEqual({ kind: "conflict", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
    expect(memory.paths("households/house-1/captureSubmissionReceipts/")).toHaveLength(1);
  });
});

function terminalTransaction(transactionId = "transaction-first"): CaptureSubmissionReceipt["transaction"] {
  return {
    stage: "terminal", downstreamKey: "payment-1",
    result: { kind: "recorded", transactionId, captureLineageId: "lineage-first", aggregateVersion: 1, editable: true },
  };
}

function terminalBalance(balanceVersion = 1): CaptureSubmissionReceipt["balance"] {
  return {
    stage: "terminal", downstreamKey: "balance-1",
    result: { kind: "recorded", status: "updated", balanceId: "balance-first", balanceVersion },
  };
}

function retryableTransaction(): CaptureSubmissionReceipt["transaction"] {
  return { stage: "retryable", downstreamKey: "payment-1", result: { kind: "retryable-failure", code: "LEDGER_UNAVAILABLE" } };
}

function retryableBalance(): CaptureSubmissionReceipt["balance"] {
  return { stage: "retryable", downstreamKey: "balance-1", result: { kind: "retryable-failure", code: "BALANCE_REPOSITORY_UNAVAILABLE" } };
}

async function fixture(composite = true) {
  const memory = new InMemoryFirestore();
  let clock = "2026-07-21T01:06:00.000Z";
  const store = new FirebaseCaptureSubmissionReceiptStore(memory as unknown as firestore.Firestore, () => clock);
  const input: CaptureBranchEnvelope = {
    ...envelope(),
    ...(composite ? {
      balanceBranch: {
        branchKey: "balance-1",
        observation: {
          contractVersion: "balance-observation.v1" as const, observationId: "balance-1",
          localCurrencyType: "gyeonggi", balanceInWon: 55000, observedAt: "2026-07-21T01:05:01.000Z",
          sourceType: "kb-card", parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
          rawPayloadHash: `sha256:${"1".repeat(64)}`,
        },
      },
    } : {}),
  };
  const payloadFingerprint = new Sha256CapturePayloadFingerprint().fingerprint(input);
  const claim = await store.claim({ envelope: input, payloadFingerprint });
  if (claim.kind === "conflict") throw new Error("fixture claim failed");
  const path = memory.paths("households/house-1/captureSubmissionReceipts/")[0];
  const writes: string[] = [];
  const runTransaction = memory.runTransaction.bind(memory);
  memory.runTransaction = operation => runTransaction(async transaction => {
    const set = transaction.set.bind(transaction);
    transaction.set = (...args) => { writes.push(args[0].path); return set(...args); };
    return operation(transaction);
  });
  return {
    memory, store, path, writes, initial: claim.receipt,
    setNow: (now: string) => { clock = now; },
    completed: {
      ...claim.receipt, state: "completed" as const,
      transaction: terminalTransaction(), balance: composite ? terminalBalance() : { stage: "absent" as const },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Capture root receipt terminal CAS", () => {
  it("completed save도 현재 payload를 검증하고 mismatch에는 쓰지 않는다", async () => {
    const { memory, store, path, completed, writes } = await fixture();
    const before = memory.document(path);
    await expect(store.save({ ...completed, payloadFingerprint: "different-payload" }))
      .rejects.toThrow("IDEMPOTENCY_PAYLOAD_MISMATCH");
    expect(memory.document(path)).toEqual(before);
    expect(writes).toEqual([]);
  });

  it("claim 없는 completed save는 문서를 생성하거나 성공하지 않는다", async () => {
    const { memory, store, completed, writes } = await fixture();
    const before = memory.paths("");
    await expect(store.save({ ...completed, rootIdempotencyKey: "unclaimed-root" }))
      .rejects.toThrow("CAPTURE_RECEIPT_NOT_CLAIMED");
    expect(memory.paths("")).toEqual(before);
    expect(writes).toEqual([]);
  });

  it("이미 completed인 receipt도 다른 payload의 save를 replay로 받아들이지 않는다", async () => {
    const { memory, store, path, completed, writes } = await fixture(false);
    await store.save(completed);
    const before = memory.document(path);
    await expect(store.save({ ...completed, payloadFingerprint: "different-payload" }))
      .rejects.toThrow("IDEMPOTENCY_PAYLOAD_MISMATCH");
    expect(memory.document(path)).toEqual(before);
    expect(writes).toHaveLength(1);
  });

  it("단일 거래 claim에 없던 balance branch를 추가하는 save는 쓰지 않는다", async () => {
    const { memory, store, path, completed, writes } = await fixture(false);
    const before = memory.document(path);
    await expect(store.save({ ...completed, balance: terminalBalance() }))
      .rejects.toThrow("CAPTURE_RECEIPT_BRANCH_MISMATCH");
    expect(memory.document(path)).toEqual(before);
    expect(writes).toEqual([]);
  });

  it.each([
    { transaction: { stage: "terminal", downstreamKey: "other-payment", result: { kind: "rejected", code: "OTHER" } } },
    { transaction: { stage: "absent" } },
    { balance: { stage: "absent" } },
  ] as const)("claim의 branch identity를 변경하려는 save는 쓰지 않는다: %o", async change => {
    const { memory, store, path, completed, writes } = await fixture();
    const before = memory.document(path);
    await expect(store.save({ ...completed, ...change })).rejects.toThrow("CAPTURE_RECEIPT_BRANCH_MISMATCH");
    expect(memory.document(path)).toEqual(before);
    expect(writes).toEqual([]);
  });

  it.each([{ householdId: "other-house" }, { rootIdempotencyKey: "other-root" }])(
    "같은 문서 경로의 저장 identity가 다르면 쓰지 않는다: %o", async change => {
      const { memory, store, path, completed, writes } = await fixture();
      const before = { ...memory.document(path), ...change };
      memory.seed(path, before);
      await expect(store.save(completed)).rejects.toThrow("CAPTURE_RECEIPT_IDENTITY_MISMATCH");
      expect(memory.document(path)).toEqual(before);
      expect(writes).toEqual([]);
    },
  );

  it("단일 거래 첫 완료를 반환하고 늦은 completed는 결과와 최초 TTL을 덮지 않는다", async () => {
    const { memory, store, path, completed, writes, setNow } = await fixture(false);
    expect(await store.save(completed)).toEqual(completed);
    const firstStored = memory.document(path);
    expect(firstStored).toMatchObject({ terminalAt: "2026-07-21T01:06:00.000Z", expiresAt: new Date("2026-08-20T01:06:00.000Z") });
    expect(writes).toHaveLength(1);
    setNow("2026-07-28T01:06:00.000Z");

    const replay = await store.save({ ...completed, transaction: terminalTransaction("late-different-transaction") });
    expect(replay).toEqual(completed);
    expect(memory.document(path)).toEqual(firstStored);
    expect(writes).toHaveLength(1);
  });

  it.each(["transaction-first", "balance-first"])(
    "엇갈린 partial의 terminal 결과를 합치면 completed가 된다: %s", async first => {
      const { memory, store, path, initial, completed, writes } = await fixture();
      const transactionOnly: CaptureSubmissionReceipt = {
        ...initial, state: "partial-retryable", transaction: terminalTransaction(), balance: retryableBalance(),
      };
      const balanceOnly: CaptureSubmissionReceipt = {
        ...initial, state: "partial-retryable", transaction: retryableTransaction(), balance: terminalBalance(),
      };
      const [earlier, later] = first === "transaction-first" ? [transactionOnly, balanceOnly] : [balanceOnly, transactionOnly];
      expect(await store.save(earlier)).toEqual(earlier);
      expect(memory.document(path)).not.toHaveProperty("expiresAt");
      const merged = await store.save(later);
      expect(merged).toEqual(completed);
      expect(memory.document(path)).toMatchObject(completed);
      expect(memory.document(path)).toHaveProperty("terminalAt", "2026-07-21T01:06:00.000Z");
      expect(writes).toHaveLength(2);
    },
  );

  it.each(["transaction", "balance"] as const)("다른 branch가 완료될 때 이미 terminal인 %s 결과를 보존한다", async first => {
    const { store, initial, completed } = await fixture();
    await store.save({
      ...initial, state: "partial-retryable",
      transaction: first === "transaction" ? terminalTransaction() : retryableTransaction(),
      balance: first === "balance" ? terminalBalance() : retryableBalance(),
    });
    const attempted = {
      ...completed,
      transaction: first === "transaction" ? terminalTransaction("late-replacement") : terminalTransaction(),
      balance: first === "balance" ? terminalBalance(2) : terminalBalance(),
    };
    expect(await store.save(attempted)).toEqual(completed);
  });

  it("늦은 pending 결과는 partial 및 terminal branch를 되돌리지 않는다", async () => {
    const { store, initial } = await fixture();
    const partial: CaptureSubmissionReceipt = {
      ...initial, state: "partial-retryable", transaction: terminalTransaction(), balance: retryableBalance(),
    };
    await store.save(partial);
    expect(await store.save(initial)).toEqual(partial);
  });

  it("입력 completed flag만으로 pending branch를 완료 처리하거나 TTL을 붙이지 않는다", async () => {
    const { memory, store, path, initial } = await fixture();
    expect(await store.save({ ...initial, state: "completed" })).toEqual(initial);
    expect(memory.document(path)).not.toHaveProperty("terminalAt");
    expect(memory.document(path)).not.toHaveProperty("expiresAt");
  });

  it("legacy processing의 모든 terminal branch는 결과를 유지하며 completed로 수렴한다", async () => {
    const { memory, store, path, initial, completed } = await fixture(false);
    memory.seed(path, { ...memory.document(path), ...completed, state: "processing" });
    expect(await store.save(initial)).toEqual(completed);
    expect(memory.document(path)).toMatchObject({ ...completed, terminalAt: "2026-07-21T01:06:00.000Z" });
  });

  it("commit 경합 재시도는 새 terminal을 읽고 stale 결과 대신 실제 저장된 결과를 반환한다", async () => {
    const { memory, store, path, completed, setNow } = await fixture(false);
    const runTransaction = memory.runTransaction.bind(memory);
    const winner: CaptureSubmissionReceipt = { ...completed, transaction: terminalTransaction("concurrent-winner") };
    const terminalAt = "2026-07-21T01:07:00.000Z";
    const expiresAt = new Date("2026-08-20T01:07:00.000Z");
    memory.runTransaction = async operation => {
      await expect(runTransaction(async transaction => {
        await operation(transaction);
        throw new Error("RETRY_CONFLICT");
      })).rejects.toThrow("RETRY_CONFLICT");
      expect(memory.document(path)).toHaveProperty("state", "claimed");
      memory.seed(path, { ...memory.document(path), ...winner, terminalAt, expiresAt });
      return runTransaction(operation);
    };
    setNow("2026-07-22T01:07:00.000Z");
    expect(await store.save(completed)).toEqual(winner);
    expect(memory.document(path)).toMatchObject({ ...winner, terminalAt, expiresAt });
  });

  it("save는 transaction commit이 끝나기 전에 완료 결과를 반환하지 않는다", async () => {
    const { memory, store, path, completed } = await fixture(false);
    const runTransaction = memory.runTransaction.bind(memory);
    const staged = deferred<void>();
    const allowCommit = deferred<void>();
    memory.runTransaction = operation => runTransaction(async transaction => {
      const result = await operation(transaction);
      staged.resolve();
      await allowCommit.promise;
      return result;
    });
    let settled = false;
    const saving = store.save(completed).then(result => { settled = true; return result; });
    await staged.promise;
    expect(settled).toBe(false);
    expect(memory.document(path)).toHaveProperty("state", "claimed");
    allowCommit.resolve();
    expect(await saving).toEqual(completed);
    expect(memory.document(path)).toMatchObject(completed);
  });

  it("commit 실패는 claim을 그대로 남기고 재시도에서 같은 결과를 확정한다", async () => {
    const { memory, store, path, completed } = await fixture(false);
    const runTransaction = memory.runTransaction.bind(memory);
    const before = memory.document(path);
    memory.runTransaction = operation => runTransaction(async transaction => {
      await operation(transaction);
      throw new Error("COMMIT_UNAVAILABLE");
    });
    await expect(store.save(completed)).rejects.toThrow("COMMIT_UNAVAILABLE");
    expect(memory.document(path)).toEqual(before);
    memory.runTransaction = runTransaction;
    expect(await store.save(completed)).toEqual(completed);
  });
});
