import { describe, expect, it } from "vitest";
import { createCaptureQueueBranchLifecycleDriver } from "../../../support/capture-queue-branch-lifecycle-driver";

type BranchName = "payment" | "balance";
type ServerBranchResult =
  | { kind: "Created"; resourceId: string }
  | { kind: "Duplicate"; resourceId: string }
  | { kind: "Rejected"; code: string }
  | { kind: "RetryableFailure"; code: string };

interface QueueBranch {
  branch: BranchName;
  idempotencyKey: string;
  payloadHash: string;
}

interface EnqueueInput {
  actor: { householdId: string; memberId: string };
  observationId: string;
  queuedAt: string;
  branches: readonly QueueBranch[];
}

interface QueuedEntrySnapshot {
  observationId: string;
  actor: { householdId: string; memberId: string };
  queuedAt: string;
  pendingBranches: readonly QueueBranch[];
  terminalBranches: readonly {
    branch: BranchName;
    idempotencyKey: string;
    result: Exclude<ServerBranchResult, { kind: "RetryableFailure" }>;
  }[];
  atRest: {
    algorithm: "AES-256-GCM";
    keyProvider: "AndroidKeystore";
    ciphertextOnly: true;
  };
}

interface QueueState {
  entries: readonly QueuedEntrySnapshot[];
  transportAttempts: readonly {
    observationId: string;
    branch: BranchName;
    idempotencyKey: string;
  }[];
  plaintextAtRest: readonly unknown[];
}

type EnqueueResult =
  | { kind: "Queued"; observationId: string }
  | { kind: "AlreadyQueued"; observationId: string }
  | {
      kind: "LocalFailure";
      code: "INVALID_BRANCH_SET" | "ENCRYPTED_STORE_UNAVAILABLE";
    };

export interface AndroidCaptureQueueBranchLifecycleSubject {
  enqueue(input: EnqueueInput): EnqueueResult;
  flush(input: {
    now: string;
    results: Readonly<Partial<Record<BranchName, ServerBranchResult>>>;
  }): {
    kind: "Idle" | "Retained" | "Deleted";
    pendingBranches: readonly BranchName[];
    deletionReason?:
      | "AllBranchesTerminal"
      | "Expired"
      | "SessionChanged"
      | "KeyInvalidated"
      | "DecryptionFailed";
  };
  restartProcess(): AndroidCaptureQueueBranchLifecycleSubject;
  changeSession(actor: { householdId: string; memberId: string }): void;
  logout(): void;
  invalidateKey(reason: "KeyInvalidated" | "DecryptionFailed"): void;
  state(): QueueState;
}

export function createSubject(): AndroidCaptureQueueBranchLifecycleSubject {
  return createCaptureQueueBranchLifecycleDriver();
}

const queuedAt = "2026-07-19T00:00:00+09:00";

function twoBranchInput(): EnqueueInput {
  return {
    actor: { householdId: "household-a", memberId: "member-a" },
    observationId: "observation-a",
    queuedAt,
    branches: [
      {
        branch: "payment",
        idempotencyKey: "observation-a:payment",
        payloadHash: "sha256:payment",
      },
      {
        branch: "balance",
        idempotencyKey: "observation-a:balance",
        payloadHash: "sha256:balance",
      },
    ],
  };
}

describe("Android 암호화 Queue branch별 생명주기 공개 계약", () => {
  it("[T-QUEUE-001][ING-008] network 전송 전에 원문 없는 observation과 존재 branch key를 암호화 Queue에 먼저 확정한다", () => {
    const subject = createSubject();

    expect(subject.enqueue(twoBranchInput())).toEqual({
      kind: "Queued",
      observationId: "observation-a",
    });
    expect(subject.state()).toEqual({
      entries: [
        {
          observationId: "observation-a",
          actor: { householdId: "household-a", memberId: "member-a" },
          queuedAt,
          pendingBranches: twoBranchInput().branches,
          terminalBranches: [],
          atRest: {
            algorithm: "AES-256-GCM",
            keyProvider: "AndroidKeystore",
            ciphertextOnly: true,
          },
        },
      ],
      transportAttempts: [],
      plaintextAtRest: [],
    });
  });

  it.each([
    {
      name: "branch 없음",
      branches: [],
    },
    {
      name: "같은 branch 중복",
      branches: [
        twoBranchInput().branches[0],
        {
          ...twoBranchInput().branches[0],
          idempotencyKey: "observation-a:payment-duplicate",
        },
      ],
    },
  ] as const)(
    "[T-QUEUE-001][ING-008] $name 입력은 암호화 저장과 전송 전에 거부한다",
    ({ branches }) => {
      const subject = createSubject();

      expect(subject.enqueue({ ...twoBranchInput(), branches })).toEqual({
        kind: "LocalFailure",
        code: "INVALID_BRANCH_SET",
      });
      expect(subject.state()).toEqual({
        entries: [],
        transportAttempts: [],
        plaintextAtRest: [],
      });
    },
  );

  it("[T-QUEUE-001][ING-008] 같은 observationId를 다시 enqueue해도 최초 branch key와 암호문을 덮어쓰지 않는다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());
    const before = subject.state();

    expect(
      subject.enqueue({
        ...twoBranchInput(),
        queuedAt: "2026-07-19T01:00:00+09:00",
        branches: [
          {
            branch: "payment",
            idempotencyKey: "changed-key",
            payloadHash: "sha256:changed",
          },
        ],
      }),
    ).toEqual({ kind: "AlreadyQueued", observationId: "observation-a" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-QUEUE-001][ING-008] 프로세스 재시작 뒤에도 entry와 branch idempotency key가 유지된다", () => {
    const firstProcess = createSubject();
    firstProcess.enqueue(twoBranchInput());

    const restarted = firstProcess.restartProcess();
    const result = restarted.flush({
      now: "2026-07-19T00:10:00+09:00",
      results: {
        payment: { kind: "Created", resourceId: "expense-a" },
        balance: { kind: "Created", resourceId: "balance-observation-a" },
      },
    });

    expect(result).toEqual({
      kind: "Deleted",
      pendingBranches: [],
      deletionReason: "AllBranchesTerminal",
    });
    expect(restarted.state().transportAttempts).toEqual([
      {
        observationId: "observation-a",
        branch: "payment",
        idempotencyKey: "observation-a:payment",
      },
      {
        observationId: "observation-a",
        branch: "balance",
        idempotencyKey: "observation-a:balance",
      },
    ]);
  });

  it("[T-QUEUE-001][T-ING-BAL-001][ING-008][ING-009] 한 branch만 terminal이면 성공 결과를 보존하고 미완료 branch만 재시도한다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());

    expect(
      subject.flush({
        now: "2026-07-19T00:10:00+09:00",
        results: {
          payment: { kind: "Created", resourceId: "expense-a" },
          balance: { kind: "RetryableFailure", code: "UPSTREAM_TIMEOUT" },
        },
      }),
    ).toEqual({ kind: "Retained", pendingBranches: ["balance"] });
    expect(subject.state().entries[0]).toMatchObject({
      pendingBranches: [
        {
          branch: "balance",
          idempotencyKey: "observation-a:balance",
        },
      ],
      terminalBranches: [
        {
          branch: "payment",
          idempotencyKey: "observation-a:payment",
          result: { kind: "Created", resourceId: "expense-a" },
        },
      ],
    });

    expect(
      subject.flush({
        now: "2026-07-19T00:20:00+09:00",
        results: {
          balance: { kind: "Duplicate", resourceId: "balance-observation-a" },
        },
      }),
    ).toEqual({
      kind: "Deleted",
      pendingBranches: [],
      deletionReason: "AllBranchesTerminal",
    });
    expect(
      subject.state().transportAttempts.filter(({ branch }) => branch === "payment"),
    ).toHaveLength(1);
    expect(
      subject.state().transportAttempts.filter(({ branch }) => branch === "balance"),
    ).toHaveLength(2);
    expect(subject.state().entries).toEqual([]);
  });

  it("[T-QUEUE-001][T-ING-BAL-001][ING-008][ING-009] balance가 먼저 terminal이어도 payment만 같은 key로 재시도한다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());

    expect(
      subject.flush({
        now: "2026-07-19T00:10:00+09:00",
        results: {
          payment: { kind: "RetryableFailure", code: "LEDGER_TIMEOUT" },
          balance: { kind: "Created", resourceId: "balance-observation-a" },
        },
      }),
    ).toEqual({ kind: "Retained", pendingBranches: ["payment"] });
    expect(
      subject.flush({
        now: "2026-07-19T00:20:00+09:00",
        results: { payment: { kind: "Created", resourceId: "expense-a" } },
      }),
    ).toEqual({
      kind: "Deleted",
      pendingBranches: [],
      deletionReason: "AllBranchesTerminal",
    });
    expect(
      subject.state().transportAttempts.filter(({ branch }) => branch === "balance"),
    ).toHaveLength(1);
    expect(
      subject.state().transportAttempts.filter(({ branch }) => branch === "payment"),
    ).toHaveLength(2);
  });

  it("[T-QUEUE-001][T-ING-BAL-001][ING-008][ING-009] 부분 terminal 상태도 프로세스 재시작 뒤 보존되어 완료 branch를 재호출하지 않는다", () => {
    const firstProcess = createSubject();
    firstProcess.enqueue(twoBranchInput());
    firstProcess.flush({
      now: "2026-07-19T00:10:00+09:00",
      results: {
        payment: { kind: "Created", resourceId: "expense-a" },
        balance: { kind: "RetryableFailure", code: "UPSTREAM_TIMEOUT" },
      },
    });

    const restarted = firstProcess.restartProcess();
    expect(
      restarted.flush({
        now: "2026-07-19T00:20:00+09:00",
        results: {
          balance: { kind: "Created", resourceId: "balance-observation-a" },
        },
      }),
    ).toMatchObject({ kind: "Deleted", deletionReason: "AllBranchesTerminal" });
    expect(
      restarted.state().transportAttempts.filter(({ branch }) => branch === "payment"),
    ).toHaveLength(1);
    expect(
      restarted.state().transportAttempts.filter(({ branch }) => branch === "balance"),
    ).toHaveLength(2);
  });

  it.each([
    {
      name: "Created",
      payment: { kind: "Created", resourceId: "expense-a" } as const,
    },
    {
      name: "Duplicate",
      payment: { kind: "Duplicate", resourceId: "expense-a" } as const,
    },
    {
      name: "Rejected",
      payment: { kind: "Rejected", code: "CARD_NOT_OWNED" } as const,
    },
  ])(
    "[T-QUEUE-001][ING-008] 단일 payment branch의 $name terminal 결과는 entry를 즉시 삭제한다",
    ({ payment }) => {
      const subject = createSubject();
      subject.enqueue({
        ...twoBranchInput(),
        branches: [twoBranchInput().branches[0]],
      });

      expect(
        subject.flush({
          now: "2026-07-19T01:00:00+09:00",
          results: { payment },
        }),
      ).toEqual({
        kind: "Deleted",
        pendingBranches: [],
        deletionReason: "AllBranchesTerminal",
      });
      expect(subject.state().entries).toEqual([]);
    },
  );

  it("[T-QUEUE-001][ING-008] queuedAt부터 정확히 72시간이면 미전송 상태로 만료 삭제한다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());

    expect(
      subject.flush({
        now: "2026-07-22T00:00:00+09:00",
        results: {},
      }),
    ).toEqual({
      kind: "Deleted",
      pendingBranches: [],
      deletionReason: "Expired",
    });
    expect(subject.state().transportAttempts).toEqual([]);
  });

  it("[T-QUEUE-001][ING-008] queuedAt부터 71시간 59분 59초에는 만료시키지 않고 같은 branch key로 재시도한다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());

    expect(
      subject.flush({
        now: "2026-07-21T23:59:59+09:00",
        results: {
          payment: { kind: "RetryableFailure", code: "OFFLINE" },
          balance: { kind: "RetryableFailure", code: "OFFLINE" },
        },
      }),
    ).toEqual({
      kind: "Retained",
      pendingBranches: ["payment", "balance"],
    });
    expect(subject.state().transportAttempts).toEqual([
      {
        observationId: "observation-a",
        branch: "payment",
        idempotencyKey: "observation-a:payment",
      },
      {
        observationId: "observation-a",
        branch: "balance",
        idempotencyKey: "observation-a:balance",
      },
    ]);
  });

  it("[T-QUEUE-001][T-ING-BAL-001][ING-008] 일부 terminal 결과를 보존 중이어도 72시간이 되면 남은 branch를 전송하지 않고 삭제한다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());
    subject.flush({
      now: "2026-07-19T00:10:00+09:00",
      results: {
        payment: { kind: "Created", resourceId: "expense-a" },
        balance: { kind: "RetryableFailure", code: "UPSTREAM_TIMEOUT" },
      },
    });
    const attemptsBeforeExpiry = subject.state().transportAttempts;

    expect(
      subject.flush({
        now: "2026-07-22T00:00:00+09:00",
        results: {
          balance: { kind: "Created", resourceId: "too-late" },
        },
      }),
    ).toEqual({
      kind: "Deleted",
      pendingBranches: [],
      deletionReason: "Expired",
    });
    expect(subject.state().transportAttempts).toEqual(attemptsBeforeExpiry);
    expect(subject.state().entries).toEqual([]);
  });

  it.each([
    {
      name: "member 변경",
      actor: { householdId: "household-a", memberId: "member-b" },
    },
    {
      name: "household 변경",
      actor: { householdId: "household-b", memberId: "member-a" },
    },
  ])(
    "[T-QUEUE-001][ING-008] $name은 이전 actor Queue를 전송 없이 제거한다",
    ({ actor }) => {
      const subject = createSubject();
      subject.enqueue(twoBranchInput());

      subject.changeSession(actor);

      expect(subject.state().entries).toEqual([]);
      expect(subject.state().transportAttempts).toEqual([]);
    },
  );

  it("[T-QUEUE-001][ING-008] 로그아웃은 현재 actor Queue를 전송 없이 제거한다", () => {
    const subject = createSubject();
    subject.enqueue(twoBranchInput());

    subject.logout();

    expect(subject.state().entries).toEqual([]);
    expect(subject.state().transportAttempts).toEqual([]);
    expect(subject.state().plaintextAtRest).toEqual([]);
  });

  it.each(["KeyInvalidated", "DecryptionFailed"] as const)(
    "[T-QUEUE-001][ING-008] $s이면 entry를 서버로 보내지 않고 삭제한다",
    (reason) => {
      const subject = createSubject();
      subject.enqueue(twoBranchInput());

      subject.invalidateKey(reason);

      expect(subject.state().entries).toEqual([]);
      expect(subject.state().transportAttempts).toEqual([]);
      expect(subject.state().plaintextAtRest).toEqual([]);
    },
  );
});
