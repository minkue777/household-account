import { describe, expect, it } from "vitest";

import { createCaptureRetryQueueFixture } from "../../../support/capture-retry-queue-fixture";

export interface CaptureRetryEntry {
  sessionGeneration: string;
  householdId: string;
  memberId: string;
  idempotencyKey: string;
  queuedAt: string;
  payload: {
    contractVersion: "capture-envelope.v1";
    observationId: string;
  };
}

export type CaptureRetryDecision =
  | { kind: "Dispatch"; idempotencyKey: string }
  | { kind: "ExpiredAndDeleted" }
  | { kind: "DeletedForInvalidKey" }
  | { kind: "NoEntry" };

export interface CaptureRetryQueueState {
  entryCount: number;
  atRest: {
    encryption: "AES-256-GCM";
    uniqueIvPerEntry: true;
    keyLocation: "AndroidKeystore";
    keyExportable: false;
    backupEligible: false;
    plaintextPayloadPresent: false;
  };
}

export interface AndroidCaptureRetryQueueSubject {
  enqueue(entry: CaptureRetryEntry): Promise<void>;
  retryAt(now: string): Promise<CaptureRetryDecision>;
  invalidateEncryptionKey(): void;
  state(): CaptureRetryQueueState;
}

export function createSubject(): AndroidCaptureRetryQueueSubject {
  return createCaptureRetryQueueFixture();
}

const entry = (): CaptureRetryEntry => ({
  sessionGeneration: "session-1",
  householdId: "household-1",
  memberId: "member-1",
  idempotencyKey: "capture-key-1",
  queuedAt: "2026-07-19T10:00:00+09:00",
  payload: {
    contractVersion: "capture-envelope.v1",
    observationId: "observation-1",
  },
});

describe("Android 결제 재전송 Queue 보안·72시간 공개 계약", () => {
  it("[T-QUEUE-001][ING-008][DEC-032] 72시간 미만 재시도는 최초 idempotency key를 그대로 사용한다", async () => {
    const subject = createSubject();
    await subject.enqueue(entry());

    expect(await subject.retryAt("2026-07-22T09:59:59+09:00")).toEqual({
      kind: "Dispatch",
      idempotencyKey: "capture-key-1",
    });
    expect(subject.state().entryCount).toBe(1);
  });

  it("[T-QUEUE-001][ING-008][DEC-032] queuedAt부터 정확히 72시간이 되면 전송하지 않고 즉시 삭제한다", async () => {
    const subject = createSubject();
    await subject.enqueue(entry());

    expect(await subject.retryAt("2026-07-22T10:00:00+09:00")).toEqual({
      kind: "ExpiredAndDeleted",
    });
    expect(subject.state().entryCount).toBe(0);
    expect(await subject.retryAt("2026-07-23T10:00:00+09:00")).toEqual({
      kind: "NoEntry",
    });
  });

  it("[T-QUEUE-001][ING-008][DEC-032] Queue는 고유 IV의 AES-256-GCM 암호문만 저장하고 key·payload를 export·backup하지 않는다", async () => {
    const subject = createSubject();
    await subject.enqueue(entry());

    expect(subject.state().atRest).toEqual({
      encryption: "AES-256-GCM",
      uniqueIvPerEntry: true,
      keyLocation: "AndroidKeystore",
      keyExportable: false,
      backupEligible: false,
      plaintextPayloadPresent: false,
    });
  });

  it("[T-QUEUE-001][ING-008][DEC-032] Keystore key 무효화나 인증 실패 entry는 서버로 보내지 않고 삭제한다", async () => {
    const subject = createSubject();
    await subject.enqueue(entry());
    subject.invalidateEncryptionKey();

    expect(await subject.retryAt("2026-07-19T10:01:00+09:00")).toEqual({
      kind: "DeletedForInvalidKey",
    });
    expect(subject.state().entryCount).toBe(0);
  });

  it("72시간 경계는 표기 timezone이 아니라 같은 절대 시각을 기준으로 판정한다", async () => {
    const subject = createSubject();
    await subject.enqueue(entry());

    expect(await subject.retryAt("2026-07-22T01:00:00Z")).toEqual({
      kind: "ExpiredAndDeleted",
    });
  });

  it("하나의 Keystore key가 무효화되면 그 key로 봉인한 모든 entry를 폐기한다", async () => {
    const subject = createSubject();
    await subject.enqueue(entry());
    await subject.enqueue({
      ...entry(),
      idempotencyKey: "capture-key-2",
      payload: {
        contractVersion: "capture-envelope.v1",
        observationId: "observation-2",
      },
    });
    subject.invalidateEncryptionKey();

    expect(await subject.retryAt("2026-07-19T10:01:00+09:00")).toEqual({
      kind: "DeletedForInvalidKey",
    });
    expect(subject.state().entryCount).toBe(0);
  });

  it("빈 Queue는 key 상태와 무관하게 전송할 항목이 없다고 응답한다", async () => {
    const subject = createSubject();
    subject.invalidateEncryptionKey();

    expect(await subject.retryAt("2026-07-19T10:01:00+09:00")).toEqual({
      kind: "NoEntry",
    });
  });
});
