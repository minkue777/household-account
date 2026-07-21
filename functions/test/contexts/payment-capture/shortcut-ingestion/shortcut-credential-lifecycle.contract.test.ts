import { describe, expect, it } from "vitest";
import { createShortcutCredentialLifecycleDriver } from "../../../support/shortcut-credential-lifecycle-driver";

export interface ShortcutSessionFixture {
  principalUid: string;
  householdId: string;
  memberId: string;
  membershipState: "active" | "removed";
  householdState: "active" | "deleted" | "purging";
}

export interface InvitationCodeFixture {
  rawCode: string;
  householdId: string;
  issuedAt: string;
  expiresAt: string;
  status: "unused" | "used";
}

export interface ShortcutCredentialLifecycleFixture {
  sessions: readonly ShortcutSessionFixture[];
  invitationCodes?: readonly InvitationCodeFixture[];
  issueOutcome?: "success" | "retryable-failure";
  credentials?: readonly {
    testOnlyRawCredential: string;
    credentialId: string;
    credentialVersion: number;
    subjectUid: string;
    householdId: string;
    memberId: string;
    capabilities: readonly ["paymentCapture:submit"];
    issuedAt: string;
    keyVersion: string;
    status: "active" | "revoked";
  }[];
}

export interface ShortcutCredentialActor {
  principalUid: string;
  householdId: string;
  actingMemberId: string;
  capabilities: readonly ["paymentCapture:submit"];
}

export type IssueShortcutCredentialResult =
  | {
      kind: "issued";
      credentialId: string;
      credentialVersion: number;
      rawCredential: string;
      installUrl: string;
      issuedAt: string;
    }
  | {
      kind: "alreadyIssued";
      credentialId: string;
      credentialVersion: number;
    }
  | {
      kind: "forbidden";
      code: "HOUSEHOLD_FORBIDDEN";
    }
  | {
      kind: "retryableFailure";
      code: string;
    };

export type ShortcutCredentialAuthorizationResult =
  | {
      kind: "authorized";
      actor: ShortcutCredentialActor;
    }
  | {
      kind: "unauthenticated";
      httpStatus: 401;
      code:
        | "AUTH_REQUIRED"
        | "CREDENTIAL_REVOKED"
        | "CREDENTIAL_REPLACED"
        | "CREDENTIAL_KEY_VERSION_INVALID";
    }
  | {
      kind: "forbidden";
      httpStatus: 403;
      code: "HOUSEHOLD_FORBIDDEN";
    };

export type ShortcutCredentialStatusResult =
  | {
      kind: "found";
      credential: {
        credentialId: string;
        credentialVersion: number;
        status: "active" | "revoked";
        masked: true;
        issuedAt: string;
        lastUsedAt?: string;
      };
    }
  | { kind: "notFound" }
  | { kind: "forbidden"; code: "HOUSEHOLD_FORBIDDEN" };

export type RevokeShortcutCredentialResult =
  | {
      kind: "revoked";
      credentialId: string;
      credentialVersion: number;
    }
  | { kind: "alreadyRevoked"; credentialId: string }
  | { kind: "notFound" }
  | { kind: "forbidden"; code: "HOUSEHOLD_FORBIDDEN" }
  | { kind: "conflict"; code: "CREDENTIAL_VERSION_MISMATCH" };

export interface ShortcutCredentialLifecycleContractSubject {
  issue(input: {
    session: ShortcutSessionFixture;
    requestedAt: string;
    idempotencyKey: string;
  }): Promise<IssueShortcutCredentialResult>;

  authorize(input: {
    bearerCredential: string | null;
    requestedAt: string;
  }): Promise<ShortcutCredentialAuthorizationResult>;

  getStatus(input: {
    session: ShortcutSessionFixture;
  }): Promise<ShortcutCredentialStatusResult>;

  revoke(input: {
    session: ShortcutSessionFixture;
    credentialId: string;
    expectedVersion: number;
    requestedAt: string;
    idempotencyKey: string;
  }): Promise<RevokeShortcutCredentialResult>;
}

export function createSubject(
  _fixture: ShortcutCredentialLifecycleFixture,
): ShortcutCredentialLifecycleContractSubject {
  return createShortcutCredentialLifecycleDriver(_fixture);
}

const memberA: ShortcutSessionFixture = {
  principalUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  membershipState: "active",
  householdState: "active",
};

const memberB: ShortcutSessionFixture = {
  principalUid: "uid-b",
  householdId: "household-a",
  memberId: "member-b",
  membershipState: "active",
  householdState: "active",
};

function requireIssued(
  result: IssueShortcutCredentialResult,
): Extract<IssueShortcutCredentialResult, { kind: "issued" }> {
  expect(result.kind).toBe("issued");
  if (result.kind !== "issued") {
    throw new Error("계약 fixture에서 Shortcut credential 발급이 실패했습니다.");
  }
  return result;
}

describe("Shortcut 전용 credential 수명주기 공개 계약", async () => {
  it("[T-IOS-SEC-002] 활성 Google Membership의 자기 범위로만 credential을 발급한다", async () => {
    const subject = createSubject({ sessions: [memberA] });

    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );
    const authorized = await subject.authorize({
      bearerCredential: issued.rawCredential,
      requestedAt: "2026-07-19T09:01:00+09:00",
    });

    expect(authorized).toEqual({
      kind: "authorized",
      actor: {
        principalUid: "uid-a",
        householdId: "household-a",
        actingMemberId: "member-a",
        capabilities: ["paymentCapture:submit"],
      },
    });
  });

  it("[T-IOS-SEC-002] 원문은 발급 응답에만 있고 상태 조회에서는 재노출하지 않는다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );

    const status = await subject.getStatus({ session: memberA });
    const serialized = JSON.stringify(status);

    expect(status.kind).toBe("found");
    expect(serialized).not.toContain(issued.rawCredential);
    expect(serialized).not.toContain("secretHash");
    expect(serialized).not.toContain("rawCredential");
  });

  it("[T-IOS-SEC-002][IOS-013][DEC-033] 같은 발급 idempotency key 재전송은 원문 없이 AlreadyIssued만 반환한다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const first = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );

    const retried = await subject.issue({
      session: memberA,
      requestedAt: "2026-07-19T09:00:01+09:00",
      idempotencyKey: "issue-member-a-1",
    });

    expect(retried).toEqual({
      kind: "alreadyIssued",
      credentialId: first.credentialId,
      credentialVersion: first.credentialVersion,
    });
    expect(JSON.stringify(retried)).not.toContain(first.rawCredential);
    expect(retried).not.toHaveProperty("rawCredential");
    expect(retried).not.toHaveProperty("installUrl");
    expect(
      await subject.authorize({
        bearerCredential: first.rawCredential,
        requestedAt: "2026-07-19T09:00:02+09:00",
      }),
    ).toMatchObject({ kind: "authorized" });
  });

  it("[DEC-033] 5분 초대 코드와 달리 Shortcut credential은 5분 뒤에도 자동 만료하지 않는다", async () => {
    const invitationCode = "invite-valid-for-five-minutes";
    const subject = createSubject({
      sessions: [memberA],
      invitationCodes: [
        {
          rawCode: invitationCode,
          householdId: "household-a",
          issuedAt: "2026-07-19T09:00:00+09:00",
          expiresAt: "2026-07-19T09:05:00+09:00",
          status: "unused",
        },
      ],
    });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );

    expect(
      await subject.authorize({
        bearerCredential: issued.rawCredential,
        requestedAt: "2026-07-19T09:05:01+09:00",
      }),
    ).toMatchObject({ kind: "authorized" });
    expect(
      await subject.authorize({
        bearerCredential: invitationCode,
        requestedAt: "2026-07-19T09:01:00+09:00",
      }),
    ).toEqual({
      kind: "unauthenticated",
      httpStatus: 401,
      code: "AUTH_REQUIRED",
    });
  });

  it("[DEC-033] 활성 Membership인 동안 정기 자동 만료 없이 계속 유효하다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );

    const result = await subject.authorize({
      bearerCredential: issued.rawCredential,
      requestedAt: "2027-07-19T09:00:00+09:00",
    });

    expect(result).toMatchObject({ kind: "authorized" });
  });

  it("[T-IOS-SEC-002] 재발급은 새 credential 발급과 기존 credential 폐기를 하나의 결과로 만든다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const first = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );
    const replacement = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:10:00+09:00",
        idempotencyKey: "issue-member-a-2",
      }),
    );

    expect(replacement.credentialId).not.toBe(first.credentialId);
    expect(
      await subject.authorize({
        bearerCredential: first.rawCredential,
        requestedAt: "2026-07-19T09:10:01+09:00",
      }),
    ).toEqual({
      kind: "unauthenticated",
      httpStatus: 401,
      code: "CREDENTIAL_REVOKED",
    });
    expect(
      await subject.authorize({
        bearerCredential: replacement.rawCredential,
        requestedAt: "2026-07-19T09:10:01+09:00",
      }),
    ).toMatchObject({ kind: "authorized" });
  });

  it("[T-IOS-SEC-002] 재발급 commit이 실패하면 기존 credential을 먼저 폐기하지 않는다", async () => {
    const existingRawCredential = "existing-shortcut-credential";
    const subject = createSubject({
      sessions: [memberA],
      issueOutcome: "retryable-failure",
      credentials: [
        {
          testOnlyRawCredential: existingRawCredential,
          credentialId: "credential-existing",
          credentialVersion: 1,
          subjectUid: "uid-a",
          householdId: "household-a",
          memberId: "member-a",
          capabilities: ["paymentCapture:submit"],
          issuedAt: "2026-07-01T09:00:00+09:00",
          keyVersion: "signing-key-v1",
          status: "active",
        },
      ],
    });

    const failedReplacement = await subject.issue({
      session: memberA,
      requestedAt: "2026-07-19T09:10:00+09:00",
      idempotencyKey: "replace-member-a-1",
    });

    expect(failedReplacement).toMatchObject({ kind: "retryableFailure" });
    expect(
      await subject.authorize({
        bearerCredential: existingRawCredential,
        requestedAt: "2026-07-19T09:10:01+09:00",
      }),
    ).toMatchObject({ kind: "authorized" });
  });

  it("[IOS-013] 명시적 폐기 직후 기존 credential을 거부한다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );

    const revoked = await subject.revoke({
      session: memberA,
      credentialId: issued.credentialId,
      expectedVersion: issued.credentialVersion,
      requestedAt: "2026-07-19T09:10:00+09:00",
      idempotencyKey: "revoke-member-a-1",
    });

    expect(revoked).toMatchObject({
      kind: "revoked",
      credentialId: issued.credentialId,
    });
    expect(
      await subject.authorize({
        bearerCredential: issued.rawCredential,
        requestedAt: "2026-07-19T09:10:01+09:00",
      }),
    ).toEqual({
      kind: "unauthenticated",
      httpStatus: 401,
      code: "CREDENTIAL_REVOKED",
    });
  });

  it("[IOS-013] 같은 가구의 다른 멤버도 타인의 credential을 폐기할 수 없다", async () => {
    const subject = createSubject({ sessions: [memberA, memberB] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-member-a-1",
      }),
    );

    expect(
      await subject.revoke({
        session: memberB,
        credentialId: issued.credentialId,
        expectedVersion: issued.credentialVersion,
        requestedAt: "2026-07-19T09:10:00+09:00",
        idempotencyKey: "member-b-forgery",
      }),
    ).toEqual({ kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(
      await subject.authorize({
        bearerCredential: issued.rawCredential,
        requestedAt: "2026-07-19T09:10:01+09:00",
      }),
    ).toMatchObject({ kind: "authorized" });
  });

  it.each([
    {
      name: "Membership이 제거됨",
      session: { ...memberA, membershipState: "removed" as const },
    },
    {
      name: "가구가 논리 삭제됨",
      session: { ...memberA, householdState: "deleted" as const },
    },
    {
      name: "가구가 purge 중임",
      session: { ...memberA, householdState: "purging" as const },
    },
  ])(
    "[T-IOS-SEC-002] $name 상태에서는 credential record가 active여도 요청을 금지한다",
    async ({ session }) => {
      const rawCredential = "shortcut-credential-for-inactive-access";
      const subject = createSubject({
        sessions: [session],
        invitationCodes: [],
        credentials: [
          {
            testOnlyRawCredential: rawCredential,
            credentialId: "credential-a",
            credentialVersion: 1,
            subjectUid: "uid-a",
            householdId: "household-a",
            memberId: "member-a",
            capabilities: ["paymentCapture:submit"],
            issuedAt: "2026-07-01T09:00:00+09:00",
            keyVersion: "signing-key-v1",
            status: "active",
          },
        ],
      });

      const result = await subject.authorize({
        bearerCredential: rawCredential,
        requestedAt: "2026-07-19T09:00:00+09:00",
      });

      expect(result).toEqual({
        kind: "forbidden",
        httpStatus: 403,
        code: "HOUSEHOLD_FORBIDDEN",
      });
    },
  );

  it.each([null, "", "unknown-shortcut-credential"])(
    "[T-IOS-SEC-002][IOS-013] 없거나 알 수 없는 bearer credential %s는 인증 근거가 아니다",
    async (bearerCredential) => {
      const subject = createSubject({ sessions: [memberA] });

      expect(
        await subject.authorize({
          bearerCredential,
          requestedAt: "2026-07-19T09:00:00+09:00",
        }),
      ).toEqual({
        kind: "unauthenticated",
        httpStatus: 401,
        code: "AUTH_REQUIRED",
      });
    },
  );

  it("[T-IOS-SEC-002][IOS-013] 활성 signing key와 다른 keyVersion의 credential은 거부한다", async () => {
    const rawCredential = "credential-signed-with-retired-key";
    const subject = createSubject({
      sessions: [memberA],
      credentials: [
        {
          testOnlyRawCredential: rawCredential,
          credentialId: "credential-old-key",
          credentialVersion: 1,
          subjectUid: "uid-a",
          householdId: "household-a",
          memberId: "member-a",
          capabilities: ["paymentCapture:submit"],
          issuedAt: "2026-07-01T09:00:00+09:00",
          keyVersion: "signing-key-retired",
          status: "active",
        },
      ],
    });

    expect(
      await subject.authorize({
        bearerCredential: rawCredential,
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    ).toEqual({
      kind: "unauthenticated",
      httpStatus: 401,
      code: "CREDENTIAL_KEY_VERSION_INVALID",
    });
  });

  it("[T-IOS-SEC-002][IOS-013] 이미 폐기된 credential은 원문이 일치해도 거부한다", async () => {
    const rawCredential = "credential-already-revoked";
    const subject = createSubject({
      sessions: [memberA],
      credentials: [
        {
          testOnlyRawCredential: rawCredential,
          credentialId: "credential-revoked",
          credentialVersion: 2,
          subjectUid: "uid-a",
          householdId: "household-a",
          memberId: "member-a",
          capabilities: ["paymentCapture:submit"],
          issuedAt: "2026-07-01T09:00:00+09:00",
          keyVersion: "signing-key-v1",
          status: "revoked",
        },
      ],
    });

    expect(
      await subject.authorize({
        bearerCredential: rawCredential,
        requestedAt: "2026-07-19T09:00:00+09:00",
      }),
    ).toEqual({
      kind: "unauthenticated",
      httpStatus: 401,
      code: "CREDENTIAL_REVOKED",
    });
  });

  it.each([
    {
      name: "등록되지 않은 SessionScope",
      configured: [memberA],
      presented: { ...memberA, memberId: "member-forged" },
    },
    {
      name: "제거된 Membership",
      configured: [{ ...memberA, membershipState: "removed" as const }],
      presented: { ...memberA, membershipState: "removed" as const },
    },
    {
      name: "삭제된 가구",
      configured: [{ ...memberA, householdState: "deleted" as const }],
      presented: { ...memberA, householdState: "deleted" as const },
    },
    {
      name: "purge 중인 가구",
      configured: [{ ...memberA, householdState: "purging" as const }],
      presented: { ...memberA, householdState: "purging" as const },
    },
  ])(
    "[T-IOS-SEC-002][IOS-013] $name에서는 새 credential을 발급하지 않는다",
    async ({ configured, presented }) => {
      const subject = createSubject({ sessions: configured });

      expect(
        await subject.issue({
          session: presented,
          requestedAt: "2026-07-19T09:00:00+09:00",
          idempotencyKey: "forbidden-issue",
        }),
      ).toEqual({ kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" });
      expect(await subject.getStatus({ session: presented })).toEqual({
        kind: "forbidden",
        code: "HOUSEHOLD_FORBIDDEN",
      });
    },
  );

  it("[T-IOS-SEC-002][IOS-013] 상태 조회는 자기 credential의 마스킹된 metadata와 마지막 사용 시각만 반환한다", async () => {
    const subject = createSubject({ sessions: [memberA, memberB] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-status-owner",
      }),
    );
    await subject.authorize({
      bearerCredential: issued.rawCredential,
      requestedAt: "2026-07-19T09:02:00+09:00",
    });

    expect(await subject.getStatus({ session: memberA })).toEqual({
      kind: "found",
      credential: {
        credentialId: issued.credentialId,
        credentialVersion: issued.credentialVersion,
        status: "active",
        masked: true,
        issuedAt: "2026-07-19T09:00:00+09:00",
        lastUsedAt: "2026-07-19T09:02:00+09:00",
      },
    });
    expect(await subject.getStatus({ session: memberB })).toEqual({
      kind: "notFound",
    });
  });

  it("[T-IOS-SEC-002][IOS-013] 폐기의 expectedVersion이 다르면 credential을 변경하지 않는다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-before-version-conflict",
      }),
    );

    expect(
      await subject.revoke({
        session: memberA,
        credentialId: issued.credentialId,
        expectedVersion: issued.credentialVersion + 1,
        requestedAt: "2026-07-19T09:10:00+09:00",
        idempotencyKey: "revoke-version-conflict",
      }),
    ).toEqual({
      kind: "conflict",
      code: "CREDENTIAL_VERSION_MISMATCH",
    });
    expect(
      await subject.authorize({
        bearerCredential: issued.rawCredential,
        requestedAt: "2026-07-19T09:10:01+09:00",
      }),
    ).toMatchObject({ kind: "authorized" });
  });

  it("[T-IOS-SEC-002][IOS-013] 같은 폐기 idempotency key는 최초 결과를 재생하고 새 key는 AlreadyRevoked로 수렴한다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-before-idempotent-revoke",
      }),
    );
    const input = {
      session: memberA,
      credentialId: issued.credentialId,
      expectedVersion: issued.credentialVersion,
      requestedAt: "2026-07-19T09:10:00+09:00",
      idempotencyKey: "revoke-idempotent",
    };

    const first = await subject.revoke(input);
    expect(await subject.revoke(input)).toEqual(first);
    expect(
      await subject.revoke({
        ...input,
        idempotencyKey: "revoke-after-revoked",
      }),
    ).toEqual({
      kind: "alreadyRevoked",
      credentialId: issued.credentialId,
    });
  });

  it("[T-IOS-SEC-002][IOS-013][DEC-033] 설치 URL에는 credential 원문을 포함하지 않는다", async () => {
    const subject = createSubject({ sessions: [memberA] });
    const issued = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "issue-install-url",
      }),
    );

    expect(issued.installUrl).not.toContain(issued.rawCredential);
    expect(issued.installUrl).not.toContain("Authorization");
    expect(issued.installUrl).toMatch(/^https:\/\//);
  });

  it("[T-IOS-SEC-002][IOS-013] 같은 idempotency key라도 서로 다른 사용자 범위의 발급은 충돌하지 않는다", async () => {
    const subject = createSubject({ sessions: [memberA, memberB] });

    const issuedA = requireIssued(
      await subject.issue({
        session: memberA,
        requestedAt: "2026-07-19T09:00:00+09:00",
        idempotencyKey: "shared-client-key",
      }),
    );
    const issuedB = requireIssued(
      await subject.issue({
        session: memberB,
        requestedAt: "2026-07-19T09:01:00+09:00",
        idempotencyKey: "shared-client-key",
      }),
    );

    expect(issuedB.credentialId).not.toBe(issuedA.credentialId);
    expect(
      await subject.authorize({
        bearerCredential: issuedA.rawCredential,
        requestedAt: "2026-07-19T09:02:00+09:00",
      }),
    ).toMatchObject({
      kind: "authorized",
      actor: { actingMemberId: "member-a" },
    });
    expect(
      await subject.authorize({
        bearerCredential: issuedB.rawCredential,
        requestedAt: "2026-07-19T09:02:00+09:00",
      }),
    ).toMatchObject({
      kind: "authorized",
      actor: { actingMemberId: "member-b" },
    });
  });
});
