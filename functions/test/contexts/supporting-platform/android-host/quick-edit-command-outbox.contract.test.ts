import { describe, expect, it } from "vitest";

import { createQuickEditCommandOutboxFixture } from "../../../support/quick-edit-command-outbox-fixture";

export interface QuickEditCommandOutboxSubject {
  setNextCommit(result: "success" | "failure"): void;
  setNextReservation(result: "success" | "failure"): void;
  submit(input: {
    queuedAt: string;
    envelope: {
      commandId: string;
      idempotencyKey: string;
      payload: Readonly<Record<string, unknown>>;
    };
  }): Promise<
    | { kind: "accepted" }
    | {
        kind: "rejected";
        code: "OUTBOX_WRITE_FAILED" | "DELIVERY_RESERVATION_FAILED";
      }
  >;
  restartProcess(): void;
  corruptEncryptedSnapshot(kind: "ciphertext" | "codec"): void;
  deliver(input: {
    now: string;
    resultFor(commandId: string):
      | "success"
      | "already-processed"
      | "retryable"
      | "conflict"
      | "rejected"
      | "contract-failure";
  }): Promise<void>;
  deliverFailureNotifications(delivered: boolean): readonly string[];
  transitionSession(scope: {
    sessionGeneration: string;
    householdId: string;
    memberId: string;
  }): void;
  state(): {
    screen: "open" | "closed";
    entries: readonly {
      state: "pending" | "needs-attention";
      failureNotificationPending: boolean;
      envelope: {
        commandId: string;
        idempotencyKey: string;
        payload: Readonly<Record<string, unknown>>;
      };
    }[];
    attempts: readonly {
      commandId: string;
      idempotencyKey: string;
      payload: Readonly<Record<string, unknown>>;
    }[];
    failureNotificationRetryRequired: boolean;
    unrecoverableLossNotificationPending: boolean;
    atRest: {
      encryption: "AES-256-GCM";
      keyLocation: "AndroidKeystore";
      plaintextPayloadPresent: false;
      backupEligible: false;
    };
  };
}

const currentScope = {
  sessionGeneration: "session-7",
  householdId: "household-1",
  memberId: "member-1",
};

export function createSubject(): QuickEditCommandOutboxSubject {
  return createQuickEditCommandOutboxFixture(currentScope);
}

const envelope = (suffix: string) => ({
  commandId: `android:${suffix}`,
  idempotencyKey: `android-quick-edit:${suffix}`,
  payload: {
    transactionId: `transaction-${suffix}`,
    expectedVersion: 3,
    patch: { memo: `memo-${suffix}` },
  },
});

describe("Android QuickEdit command outbox 공개 계약", () => {
  it("[T-QE-007][QE-012][AND-009][DEC-067] 암호화 commit과 영속 예약이 모두 성공해야 화면을 닫는다", async () => {
    const subject = createSubject();
    subject.setNextCommit("failure");

    await expect(
      subject.submit({
        queuedAt: "2026-07-20T10:00:00+09:00",
        envelope: envelope("failed-write"),
      }),
    ).resolves.toEqual({ kind: "rejected", code: "OUTBOX_WRITE_FAILED" });
    expect(subject.state()).toMatchObject({ screen: "open", entries: [] });

    const reservationEnvelope = envelope("reservation-retry");
    subject.setNextReservation("failure");
    await expect(
      subject.submit({
        queuedAt: "2026-07-20T10:00:01+09:00",
        envelope: reservationEnvelope,
      }),
    ).resolves.toEqual({
      kind: "rejected",
      code: "DELIVERY_RESERVATION_FAILED",
    });
    expect(subject.state()).toMatchObject({ screen: "open" });
    expect(subject.state().entries).toHaveLength(1);

    // commit된 같은 envelope를 다시 제출해도 중복 저장하지 않고 예약만 재시도한다.
    await expect(
      subject.submit({
        queuedAt: "2026-07-20T10:00:02+09:00",
        envelope: reservationEnvelope,
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect(subject.state().entries).toHaveLength(1);
    expect(subject.state()).toMatchObject({
      screen: "closed",
      atRest: {
        encryption: "AES-256-GCM",
        keyLocation: "AndroidKeystore",
        plaintextPayloadPresent: false,
        backupEligible: false,
      },
    });
  });

  it("[T-QE-007][QE-012][DEC-067] process 재시작 뒤에도 고정 envelope를 FIFO 재시도하고 앞선 retryable 명령을 추월하지 않는다", async () => {
    const subject = createSubject();
    const first = envelope("first");
    const second = envelope("second");
    await subject.submit({ queuedAt: "2026-07-20T10:00:00+09:00", envelope: first });
    await subject.submit({ queuedAt: "2026-07-20T10:00:01+09:00", envelope: second });
    subject.restartProcess();

    await subject.deliver({
      now: "2026-07-20T10:01:00+09:00",
      resultFor: () => "retryable",
    });
    expect(subject.state().attempts).toEqual([first]);
    expect(subject.state().entries).toHaveLength(2);

    subject.restartProcess();
    await subject.deliver({
      now: "2026-07-20T10:02:00+09:00",
      resultFor: () => "success",
    });
    expect(subject.state().attempts).toEqual([first, second]);
    expect(subject.state().entries).toEqual([]);
  });

  it.each(["conflict", "rejected", "contract-failure"] as const)(
    "[T-QE-007][QE-012][DEC-067] terminal 결과 %s는 자동 재시도하지 않고 알림 성공 전까지만 보존한다",
    async (terminalResult) => {
      const subject = createSubject();
      await subject.submit({
        queuedAt: "2026-07-20T10:00:00+09:00",
        envelope: envelope(terminalResult),
      });

      await subject.deliver({
        now: "2026-07-20T10:01:00+09:00",
        resultFor: () => terminalResult,
      });
      expect(subject.state().entries).toEqual([
        expect.objectContaining({
          state: "needs-attention",
          failureNotificationPending: true,
        }),
      ]);

      expect(subject.deliverFailureNotifications(false)).toEqual([
        `android:${terminalResult}`,
      ]);
      expect(subject.state().entries).toHaveLength(1);
      expect(subject.state().failureNotificationRetryRequired).toBe(true);
      expect(subject.deliverFailureNotifications(true)).toEqual([
        `android:${terminalResult}`,
      ]);
      expect(subject.state().entries).toEqual([]);
      expect(subject.state().failureNotificationRetryRequired).toBe(false);
    },
  );

  it("[T-QE-007][QE-012][AND-011][DEC-067] 정확히 72시간에 만료하고 session 전환 시 이전 actor payload를 제거한다", async () => {
    const subject = createSubject();
    await subject.submit({
      queuedAt: "2026-07-20T10:00:00+09:00",
      envelope: envelope("expires"),
    });

    await subject.deliver({
      now: "2026-07-23T10:00:00+09:00",
      resultFor: () => "success",
    });
    expect(subject.state().attempts).toEqual([]);
    expect(subject.state().entries).toEqual([
      expect.objectContaining({
        state: "needs-attention",
        failureNotificationPending: true,
      }),
    ]);

    subject.transitionSession({
      sessionGeneration: "session-8",
      householdId: "household-2",
      memberId: "member-2",
    });
    expect(subject.state().entries).toEqual([]);
  });

  it.each(["ciphertext", "codec"] as const)(
    "[T-QE-007][QE-012][AND-009][DEC-067] %s 손상은 payload를 fail-closed 삭제하고 비민감 실패 신호를 알림 성공까지 보존한다",
    async (corruptionKind) => {
      const subject = createSubject();
      await subject.submit({
        queuedAt: "2026-07-20T10:00:00+09:00",
        envelope: envelope(`corrupt-${corruptionKind}`),
      });

      subject.corruptEncryptedSnapshot(corruptionKind);

      expect(subject.state()).toMatchObject({
        entries: [],
        unrecoverableLossNotificationPending: true,
        failureNotificationRetryRequired: true,
      });
      expect(subject.deliverFailureNotifications(false)).toEqual([
        "outbox-storage-loss",
      ]);
      expect(subject.state().unrecoverableLossNotificationPending).toBe(true);
      expect(subject.deliverFailureNotifications(true)).toEqual([
        "outbox-storage-loss",
      ]);
      expect(subject.state()).toMatchObject({
        unrecoverableLossNotificationPending: false,
        failureNotificationRetryRequired: false,
      });
    },
  );
});
