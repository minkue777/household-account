import { describe, expect, it } from "vitest";
import { createShortcutCredentialLifecycleDriver } from "../../../support/shortcut-credential-lifecycle-driver";
import type { IssueShortcutCredentialResult } from "../../../../src/contexts/payment-capture/shortcut-ingestion/public";

const session = {
  principalUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  membershipState: "active",
  householdState: "active",
} as const;
const requestedAt = "2026-10-05T09:00:00+09:00";
const issue = { session, requestedAt, idempotencyKey: "issue", issuanceMode: "if-absent" } as const;

function createSubject() {
  return createShortcutCredentialLifecycleDriver({ sessions: [session], activeKeyVersion: "shortcut-signing.v1" });
}

function issued(result: IssueShortcutCredentialResult) {
  expect(result.kind).toBe("issued");
  if (result.kind !== "issued") throw new Error(`Unexpected issuance: ${result.kind}`);
  return result;
}

function reissueInput(first: ReturnType<typeof issued>) {
  return {
    session, requestedAt,
    currentCredentialId: first.credentialId,
    expectedVersion: first.credentialVersion,
    idempotencyKey: "replace",
  };
}

describe("실제 Shortcut credential 수명주기의 최초 설치·교체 계약", () => {
  it("[T-IOS-SEC-002][IOS-013] 최초 원문은 응답에만 있고 저장에는 hash와 자기 범위만 남는다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const records = subject.testOnlyStorageState();
    expect(first.rawCredential.length).toBeGreaterThanOrEqual(32);
    expect(records).toEqual([expect.objectContaining({
      credentialId: first.credentialId, credentialVersion: 1,
      subjectUid: session.principalUid, householdId: session.householdId, memberId: session.memberId,
      capabilities: ["paymentCapture:submit"], secretHash: expect.stringMatching(/^[a-f0-9]{64}$/), status: "active",
    })]);
    expect(JSON.stringify(records)).not.toContain(first.rawCredential);
    expect(first.installUrl).toMatch(/^https:\/\//);
    expect(first.installUrl).not.toContain(first.rawCredential);
  });

  it.each(["issue", "another-device-issue"])(
    "[T-IOS-SEC-002][IOS-013] 활성 키가 있으면 최초 발급 key %s는 원문 없이 기존 metadata로 수렴한다",
    async idempotencyKey => {
      const subject = createSubject();
      const first = issued(await subject.issue(issue));
      expect(await subject.issue({ ...issue, idempotencyKey })).toEqual({
        kind: "alreadyIssued", credentialId: first.credentialId, credentialVersion: first.credentialVersion,
      });
      expect(subject.testOnlyStorageState()).toHaveLength(1);
    },
  );

  it("[T-IOS-SEC-002][IOS-013] 인증 성공은 lastUsedAt만 변경하고 credential의 Actor를 반환한다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const before = subject.testOnlyStorageState();
    const usedAt = "2026-10-05T10:00:00+09:00";
    expect(await subject.authorize({ bearerCredential: first.rawCredential, requestedAt: usedAt })).toEqual({
      kind: "authorized",
      actor: {
        principalUid: session.principalUid, householdId: session.householdId,
        actingMemberId: session.memberId, capabilities: ["paymentCapture:submit"],
      },
    });
    expect(subject.testOnlyStorageState()).toEqual([{ ...before[0], lastUsedAt: usedAt }]);
  });

  it("[T-IOS-SEC-002][IOS-013] 허용 signing keyVersion 밖의 credential은 저장 변경 없이 거부한다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const before = subject.testOnlyStorageState();
    expect(await subject.authorize({
      bearerCredential: first.rawCredential, requestedAt, acceptedKeyVersions: ["shortcut-signing.v2"],
    })).toMatchObject({ kind: "unauthenticated", code: "CREDENTIAL_KEY_VERSION_INVALID" });
    expect(subject.testOnlyStorageState()).toEqual(before);
  });

  it.each([
    { membershipState: "removed" as const, householdState: "active" as const },
    { membershipState: "active" as const, householdState: "deleted" as const },
  ])("[T-IOS-SEC-002][IOS-013] 비활성 Membership·가구의 발급은 저장 전에 거부한다", async states => {
    const subject = createSubject();
    expect(await subject.issue({ ...issue, session: { ...session, ...states } })).toEqual({ kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(subject.testOnlyStorageState()).toEqual([]);
  });

  it("[T-IOS-SEC-002][IOS-013] 중첩 재발급은 활성 키 하나로 수렴하고 이전 키를 교체한다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const command = reissueInput(first);
    const results = await Promise.all([
      subject.reissue({ ...command, idempotencyKey: "replace-a" }),
      subject.reissue({ ...command, idempotencyKey: "replace-b" }),
    ]);
    expect(results.filter(result => result.kind === "issued")).toHaveLength(1);
    const records = subject.testOnlyStorageState();
    expect(records.filter(record => record.status === "active")).toHaveLength(1);
    expect(records.find(record => record.credentialId === first.credentialId)).toMatchObject({
      status: "revoked", replacedByCredentialId: expect.any(String),
    });
  });

  it("[T-IOS-SEC-002][IOS-013] 재발급 commit 실패는 기존 키·receipt를 보존하여 같은 명령으로 재시도할 수 있다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const before = subject.testOnlyStorageState();
    const command = reissueInput(first);
    subject.testOnlySetNextReissueOutcome("failure");
    expect(await subject.reissue(command)).toEqual({ kind: "retryableFailure", code: "CREDENTIAL_COMMIT_UNAVAILABLE" });
    expect(subject.testOnlyStorageState()).toEqual(before);
    expect(await subject.authorize({ bearerCredential: first.rawCredential, requestedAt })).toMatchObject({ kind: "authorized" });
    issued(await subject.reissue(command));
    expect(subject.testOnlyStorageState().filter(record => record.status === "active")).toHaveLength(1);
  });

  it("[T-IOS-SEC-002][IOS-013] 재발급 재전송은 원문 없이 교체 metadata를 재생하고 이전 키만 즉시 거부한다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const command = reissueInput(first);
    const replacement = issued(await subject.reissue(command));
    expect(await subject.reissue(command)).toEqual({
      kind: "alreadyIssued", credentialId: replacement.credentialId, credentialVersion: replacement.credentialVersion,
    });
    expect(await subject.authorize({ bearerCredential: first.rawCredential, requestedAt, distinguishReplacement: true }))
      .toMatchObject({ kind: "unauthenticated", code: "CREDENTIAL_REPLACED" });
    expect(await subject.authorize({ bearerCredential: replacement.rawCredential, requestedAt }))
      .toMatchObject({ kind: "authorized", actor: { actingMemberId: session.memberId } });
    const records = subject.testOnlyStorageState();
    expect(records).toHaveLength(2);
    expect(new Set(records.map(record => record.secretHash)).size).toBe(2);
    for (const record of records) expect(record.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(records)).not.toContain(first.rawCredential);
    expect(JSON.stringify(records)).not.toContain(replacement.rawCredential);
  });

  it.each(["", "unknown-shortcut-credential-that-was-never-issued"])(
    "[T-IOS-SEC-002][IOS-013] 빈 값·알 수 없는 원문 %s는 저장 변경 없이 거부한다",
    async bearerCredential => {
      const subject = createSubject();
      issued(await subject.issue(issue));
      const before = subject.testOnlyStorageState();
      expect(await subject.authorize({ bearerCredential, requestedAt })).toMatchObject({ kind: "unauthenticated", code: "AUTH_REQUIRED" });
      expect(subject.testOnlyStorageState()).toEqual(before);
    },
  );

  it("[T-IOS-SEC-002][IOS-013] 다른 주체의 세션으로는 기존 credential을 재발급할 수 없다", async () => {
    const subject = createSubject();
    const first = issued(await subject.issue(issue));
    const before = subject.testOnlyStorageState();
    expect(await subject.reissue({
      ...reissueInput(first), session: { ...session, principalUid: "uid-b", memberId: "member-b" },
    })).toEqual({ kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" });
    expect(subject.testOnlyStorageState()).toEqual(before);
  });
});
