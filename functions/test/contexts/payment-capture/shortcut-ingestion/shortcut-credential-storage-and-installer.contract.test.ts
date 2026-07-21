import { describe, expect, it } from "vitest";
import { createShortcutCredentialStorageInstallerFixture } from "../../../support/shortcut-credential-storage-installer-fixture";

interface ShortcutCredentialSession {
  principalUid: string;
  householdId: string;
  memberId: string;
  membershipState: "active" | "removed";
  householdState: "active" | "deleted";
}

interface PersistedCredentialView {
  credentialId: string;
  credentialVersion: number;
  subjectUid: string;
  householdId: string;
  memberId: string;
  scope: "paymentCapture:submit";
  secretHash: { kind: "one-way-strong-hash"; value: string };
  keyVersion: string;
  status: "active" | "revoked" | "replaced";
  issuedAt: string;
  lastUsedAt?: string;
}

interface ShortcutDefinition {
  endpoint: "https://api.example.invalid/v2/payment-captures/shortcut";
  method: "POST";
  contentType: "application/json";
  headers: {
    Authorization: "Bearer {{importQuestion.shortcutCredential}}";
    "Idempotency-Key": "{{shortcut.executionId}}";
  };
  body: {
    contractVersion: "shortcut-payment.v1";
    message: "{{shortcut.input.paymentMessage}}";
  };
  responseHandling: "ShowTypedPaymentCaptureResult";
  importQuestions: readonly [
    {
      id: "shortcutCredential";
      prompt: "복사한 Shortcut 인증키를 붙여넣으세요";
      secret: true;
    },
  ];
}

type IssueResult =
  | {
      kind: "Issued";
      credentialId: string;
      credentialVersion: number;
      rawCredential: string;
      install: {
        definition: ShortcutDefinition;
        actions: readonly ["CopyCredential", "OpenInstallLink"];
        automationGuidance: {
          trigger: "PersonalPaymentMessage";
          action: "RunInstalledShortcut";
          setup: "UserConnectsOnceOnDevice";
        };
      };
    }
  | {
      kind: "AlreadyIssued";
      credentialId: string;
      credentialVersion: number;
    }
  | { kind: "Forbidden"; code: "MEMBERSHIP_REQUIRED" }
  | { kind: "RetryableFailure"; code: "ATOMIC_COMMIT_FAILED" };

type AuthorizationResult =
  | {
      kind: "Authorized";
      actor: { householdId: string; memberId: string };
    }
  | {
      kind: "Unauthenticated";
      code:
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_REPLACED"
        | "CREDENTIAL_KEY_VERSION_INVALID"
        | "AUTH_REQUIRED";
    }
  | { kind: "Forbidden"; code: "MEMBERSHIP_REQUIRED" };

interface ShortcutCredentialStorageState {
  credentials: readonly PersistedCredentialView[];
  rawSecretsAtRest: readonly string[];
  auditLogs: readonly string[];
}

export interface ShortcutCredentialStorageInstallerSubject {
  issue(input: {
    session: ShortcutCredentialSession;
    idempotencyKey: string;
    requestedAt: string;
  }): Promise<IssueResult>;
  reissue(input: {
    session: ShortcutCredentialSession;
    currentCredentialId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestedAt: string;
    commitOutcome?: "success" | "failure";
  }): Promise<IssueResult>;
  authorize(input: {
    rawCredential: string;
    requestedAt: string;
    acceptedKeyVersions: readonly string[];
  }): Promise<AuthorizationResult>;
  logout(session: ShortcutCredentialSession): void;
  state(): ShortcutCredentialStorageState;
}

export function createSubject(): ShortcutCredentialStorageInstallerSubject {
  return createShortcutCredentialStorageInstallerFixture();
}

const activeSession: ShortcutCredentialSession = {
  principalUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  membershipState: "active",
  householdState: "active",
};

function requireIssued(result: IssueResult): Extract<IssueResult, { kind: "Issued" }> {
  if (result.kind !== "Issued") throw new Error(`Issued 필요: ${result.kind}`);
  return result;
}

describe("Shortcut credential hash 저장·반자동 설치 공개 계약", async () => {
  it("[T-IOS-SEC-002][T-IOS-INSTALL-001][IOS-013] 최초 발급만 원문을 한 번 반환하고 저장소·로그에는 강한 hash와 메타데이터만 남긴다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-a",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const serializedState = JSON.stringify(subject.state());

    expect(issued.rawCredential.length).toBeGreaterThanOrEqual(32);
    expect(subject.state().credentials).toEqual([
      expect.objectContaining({
        credentialId: issued.credentialId,
        credentialVersion: 1,
        subjectUid: "uid-a",
        householdId: "household-a",
        memberId: "member-a",
        scope: "paymentCapture:submit",
        secretHash: {
          kind: "one-way-strong-hash",
          value: expect.any(String),
        },
        status: "active",
      }),
    ]);
    expect(subject.state().credentials[0]?.secretHash.value).not.toBe(
      issued.rawCredential,
    );
    expect(subject.state().rawSecretsAtRest).toEqual([]);
    expect(serializedState).not.toContain(issued.rawCredential);
    expect(subject.state().auditLogs.join("\n")).not.toContain(issued.rawCredential);
  });

  it("[T-IOS-SEC-002][IOS-013] 같은 발급 idempotency key 재전송과 설치 중단은 원문을 다시 노출하거나 새 credential을 만들지 않는다", async () => {
    const subject = createSubject();
    const command = {
      session: activeSession,
      idempotencyKey: "issue-a",
      requestedAt: "2026-07-19T09:00:00+09:00",
    };
    const first = requireIssued(await subject.issue(command));

    expect(await subject.issue(command)).toEqual({
      kind: "AlreadyIssued",
      credentialId: first.credentialId,
      credentialVersion: first.credentialVersion,
    });
    expect(subject.state().credentials).toHaveLength(1);
    expect(JSON.stringify(await subject.issue(command))).not.toContain(
      first.rawCredential,
    );
  });

  it("[T-IOS-INSTALL-001][IOS-013] 설치 artifact는 endpoint·POST·JSON·Authorization·응답 처리를 완성하고 사용자는 secret 질문 한 번만 답한다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-install",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );

    expect(issued.install).toEqual({
      actions: ["CopyCredential", "OpenInstallLink"],
      automationGuidance: {
        trigger: "PersonalPaymentMessage",
        action: "RunInstalledShortcut",
        setup: "UserConnectsOnceOnDevice",
      },
      definition: {
        endpoint: "https://api.example.invalid/v2/payment-captures/shortcut",
        method: "POST",
        contentType: "application/json",
        headers: {
          Authorization: "Bearer {{importQuestion.shortcutCredential}}",
          "Idempotency-Key": "{{shortcut.executionId}}",
        },
        body: {
          contractVersion: "shortcut-payment.v1",
          message: "{{shortcut.input.paymentMessage}}",
        },
        responseHandling: "ShowTypedPaymentCaptureResult",
        importQuestions: [
          {
            id: "shortcutCredential",
            prompt: "복사한 Shortcut 인증키를 붙여넣으세요",
            secret: true,
          },
        ],
      },
    });
  });

  it("[T-IOS-SEC-002][IOS-013] 인증 성공은 lastUsedAt만 갱신하고 claim의 actor만 반환한다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-auth",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );

    expect(
      await subject.authorize({
        rawCredential: issued.rawCredential,
        requestedAt: "2026-07-19T10:00:00+09:00",
        acceptedKeyVersions: ["shortcut-signing.v1"],
      }),
    ).toEqual({
      kind: "Authorized",
      actor: { householdId: "household-a", memberId: "member-a" },
    });
    expect(subject.state().credentials[0]).toMatchObject({
      lastUsedAt: "2026-07-19T10:00:00+09:00",
      status: "active",
    });
  });

  it("[T-IOS-SEC-002][IOS-013] 허용 signing keyVersion에서 빠진 credential은 저장을 바꾸지 않고 거부한다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-key-version",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const before = subject.state();

    expect(
      await subject.authorize({
        rawCredential: issued.rawCredential,
        requestedAt: "2026-07-19T10:00:00+09:00",
        acceptedKeyVersions: ["shortcut-signing.v2"],
      }),
    ).toEqual({
      kind: "Unauthenticated",
      code: "CREDENTIAL_KEY_VERSION_INVALID",
    });
    expect(subject.state()).toEqual(before);
  });

  it.each([
    { membershipState: "removed" as const, householdState: "active" as const },
    { membershipState: "active" as const, householdState: "deleted" as const },
  ])(
    "[T-IOS-SEC-002][IOS-013] 비활성 Membership 또는 삭제 가구는 발급 전에 거부한다",
    async ({ membershipState, householdState }) => {
      const subject = createSubject();

      expect(
        await subject.issue({
          session: { ...activeSession, membershipState, householdState },
          idempotencyKey: "issue-forbidden",
          requestedAt: "2026-07-19T09:00:00+09:00",
        }),
      ).toEqual({ kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" });
      expect(subject.state().credentials).toEqual([]);
    },
  );

  it("[T-IOS-SEC-002][IOS-013] 명시적 재발급 경합은 새 active 하나만 만들고 이전 credential을 replaced로 원자 전이한다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-replace",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const command = {
      session: activeSession,
      currentCredentialId: issued.credentialId,
      expectedVersion: issued.credentialVersion,
      requestedAt: "2026-07-19T11:00:00+09:00",
    };

    const results = await Promise.all([
      await subject.reissue({ ...command, idempotencyKey: "replace-a" }),
      await subject.reissue({ ...command, idempotencyKey: "replace-b" }),
    ]);

    expect(results.filter(({ kind }) => kind === "Issued")).toHaveLength(1);
    expect(subject.state().credentials.filter(({ status }) => status === "active"))
      .toHaveLength(1);
    expect(
      subject.state().credentials.find(
        ({ credentialId }) => credentialId === issued.credentialId,
      ),
    ).toMatchObject({ status: "replaced" });
  });

  it("[T-IOS-SEC-002][IOS-013] 재발급 commit 실패는 기존 credential을 active로 유지하고 새 hash를 남기지 않는다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-failure",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const before = subject.state();

    expect(
      await subject.reissue({
        session: activeSession,
        currentCredentialId: issued.credentialId,
        expectedVersion: issued.credentialVersion,
        idempotencyKey: "replace-failure",
        requestedAt: "2026-07-19T11:00:00+09:00",
        commitOutcome: "failure",
      }),
    ).toEqual({ kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-IOS-SEC-002][IOS-013] PWA 로그아웃만으로 credential을 폐기하지 않는다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-logout",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );

    subject.logout(activeSession);

    expect(subject.state().credentials).toEqual([
      expect.objectContaining({ credentialId: issued.credentialId, status: "active" }),
    ]);
  });

  it("[T-IOS-SEC-002][IOS-013] 활성 credential이 있으면 다른 최초 발급 key도 원문 없이 현재 metadata로 수렴한다", async () => {
    const subject = createSubject();
    const first = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-first",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );

    expect(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-different-client-key",
        requestedAt: "2026-07-19T09:05:00+09:00",
      }),
    ).toEqual({
      kind: "AlreadyIssued",
      credentialId: first.credentialId,
      credentialVersion: first.credentialVersion,
    });
    expect(subject.state().credentials).toHaveLength(1);
  });

  it("[T-IOS-SEC-002][IOS-013] 같은 명시적 재발급 key 재전송은 새 원문 없이 교체 credential metadata만 재생한다", async () => {
    const subject = createSubject();
    const first = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-idempotent-reissue",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const command = {
      session: activeSession,
      currentCredentialId: first.credentialId,
      expectedVersion: first.credentialVersion,
      idempotencyKey: "idempotent-reissue",
      requestedAt: "2026-07-19T10:00:00+09:00",
    };
    const replacement = requireIssued(await subject.reissue(command));

    const replay = await subject.reissue({
      ...command,
      requestedAt: "2026-07-19T10:01:00+09:00",
    });
    expect(replay).toEqual({
      kind: "AlreadyIssued",
      credentialId: replacement.credentialId,
      credentialVersion: replacement.credentialVersion,
    });
    expect(JSON.stringify(replay)).not.toContain(replacement.rawCredential);
    expect(subject.state().credentials).toHaveLength(2);
  });

  it("[T-IOS-SEC-002][IOS-013] 교체된 원문은 즉시 REPLACED로 거부하고 새 원문만 인증한다", async () => {
    const subject = createSubject();
    const first = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-auth-replacement",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const replacement = requireIssued(
      await subject.reissue({
        session: activeSession,
        currentCredentialId: first.credentialId,
        expectedVersion: first.credentialVersion,
        idempotencyKey: "replace-for-auth",
        requestedAt: "2026-07-19T10:00:00+09:00",
      }),
    );

    expect(
      await subject.authorize({
        rawCredential: first.rawCredential,
        requestedAt: "2026-07-19T10:01:00+09:00",
        acceptedKeyVersions: ["shortcut-signing.v1"],
      }),
    ).toEqual({ kind: "Unauthenticated", code: "CREDENTIAL_REPLACED" });
    expect(
      await subject.authorize({
        rawCredential: replacement.rawCredential,
        requestedAt: "2026-07-19T10:01:00+09:00",
        acceptedKeyVersions: ["shortcut-signing.v1"],
      }),
    ).toEqual({
      kind: "Authorized",
      actor: { householdId: "household-a", memberId: "member-a" },
    });
  });

  it.each(["", "unknown-shortcut-credential-that-was-never-issued"])(
    "[T-IOS-SEC-002][IOS-013] 빈 값이나 알 수 없는 원문(%s)은 상태를 바꾸지 않고 AUTH_REQUIRED로 거부한다",
    async (rawCredential) => {
      const subject = createSubject();
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-unknown-auth",
        requestedAt: "2026-07-19T09:00:00+09:00",
      });
      const before = subject.state();

      expect(
        await subject.authorize({
          rawCredential,
          requestedAt: "2026-07-19T10:00:00+09:00",
          acceptedKeyVersions: ["shortcut-signing.v1"],
        }),
      ).toEqual({ kind: "Unauthenticated", code: "AUTH_REQUIRED" });
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-IOS-SEC-002][IOS-013] 실패한 재발급은 idempotency receipt를 소비하지 않아 같은 명령으로 안전하게 재시도한다", async () => {
    const subject = createSubject();
    const first = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-retry",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const command = {
      session: activeSession,
      currentCredentialId: first.credentialId,
      expectedVersion: first.credentialVersion,
      idempotencyKey: "reissue-retry-same-key",
      requestedAt: "2026-07-19T10:00:00+09:00",
    };

    expect(
      await subject.reissue({ ...command, commitOutcome: "failure" }),
    ).toEqual({ kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" });
    expect((await subject.reissue(command)).kind).toBe("Issued");
    expect(subject.state().credentials.filter(({ status }) => status === "active"))
      .toHaveLength(1);
  });

  it("[T-IOS-SEC-002][IOS-013] 다른 주체의 세션으로는 기존 credential을 재발급할 수 없다", async () => {
    const subject = createSubject();
    const first = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-cross-subject-reissue",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const before = subject.state();

    expect(
      await subject.reissue({
        session: {
          ...activeSession,
          principalUid: "uid-b",
          memberId: "member-b",
        },
        currentCredentialId: first.credentialId,
        expectedVersion: first.credentialVersion,
        idempotencyKey: "cross-subject-reissue",
        requestedAt: "2026-07-19T10:00:00+09:00",
      }),
    ).toEqual({ kind: "Forbidden", code: "MEMBERSHIP_REQUIRED" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-IOS-SEC-002][IOS-013] 재발급 전후 원문은 서로 다른 256-bit hash로만 보관한다", async () => {
    const subject = createSubject();
    const first = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-hash-rotation",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );
    const replacement = requireIssued(
      await subject.reissue({
        session: activeSession,
        currentCredentialId: first.credentialId,
        expectedVersion: first.credentialVersion,
        idempotencyKey: "rotate-hash",
        requestedAt: "2026-07-19T10:00:00+09:00",
      }),
    );
    const hashes = subject.state().credentials.map(
      ({ secretHash }) => secretHash.value,
    );

    expect(new Set(hashes).size).toBe(2);
    expect(hashes).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(hashes).not.toContain(first.rawCredential);
    expect(hashes).not.toContain(replacement.rawCredential);
  });

  it("[T-IOS-INSTALL-001][IOS-013] 설치 definition은 발급된 원문을 내장하지 않고 secret 자리표시자만 가진다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-install-placeholder",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );

    expect(JSON.stringify(issued.install)).not.toContain(issued.rawCredential);
    expect(issued.install.definition.headers.Authorization).toBe(
      "Bearer {{importQuestion.shortcutCredential}}",
    );
  });

  it("[T-IOS-SEC-002][IOS-013] 로그아웃 뒤에도 설치된 credential은 계속 인증된다", async () => {
    const subject = createSubject();
    const issued = requireIssued(
      await subject.issue({
        session: activeSession,
        idempotencyKey: "issue-before-logout-auth",
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    );

    subject.logout(activeSession);

    expect(
      await subject.authorize({
        rawCredential: issued.rawCredential,
        requestedAt: "2026-07-19T10:00:00+09:00",
        acceptedKeyVersions: ["shortcut-signing.v1"],
      }),
    ).toMatchObject({ kind: "Authorized" });
  });
});
