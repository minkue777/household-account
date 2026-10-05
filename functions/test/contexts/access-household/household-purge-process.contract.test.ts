import { describe, expect, it } from "vitest";
import type {
  HouseholdPurgeAdministrativeActor,
  HouseholdPurgeParticipant,
  HouseholdPurgeSystemActor,
} from "../../../src/contexts/access/public";
import {
  createHouseholdPurgeProcessFixtureSubject,
  type HouseholdPurgeProcessFixture,
  type HouseholdPurgeProcessFixtureSubject,
} from "../../support/household-purge-process-fixture";

/** 교체 가능한 공개 Port와 관찰용 fixture driver의 계약 경계입니다. */
export interface HouseholdPurgeProcessContractSubject
  extends HouseholdPurgeProcessFixtureSubject {}

export function createSubject(
  fixture: HouseholdPurgeProcessFixture,
): HouseholdPurgeProcessContractSubject {
  return createHouseholdPurgeProcessFixtureSubject(fixture);
}

const householdId = "house-purge";
const participants = [
  "household-finance",
  "payment-capture",
  "portfolio",
  "notifications",
  "access-household",
] as const satisfies readonly HouseholdPurgeParticipant[];

const claims = [
  {
    claimRef: "claim-a",
    principalRef: "principal-a",
    householdId,
    membershipId: "membership-a",
    version: 3,
  },
  {
    claimRef: "claim-b",
    principalRef: "principal-b",
    householdId,
    membershipId: "membership-b",
    version: 5,
  },
  {
    claimRef: "claim-c",
    principalRef: "principal-c",
    householdId,
    membershipId: "membership-c",
    version: 2,
  },
] as const;

const contextDataDigests = {
  "household-finance": "finance-data",
  "payment-capture": "capture-data",
  portfolio: "portfolio-data",
  notifications: "notification-data",
  "access-household": "access-data",
} as const;

const purgeAdmin: HouseholdPurgeAdministrativeActor = {
  principalRef: "verified-purge-admin",
  capabilities: ["household.purge.permanent", "household.purge.read"],
};

const purgeSystem: HouseholdPurgeSystemActor = {
  systemRef: "access-purge-runner",
  capabilities: ["householdLifecycle:purge"],
};

const fixture = (
  overrides: Partial<HouseholdPurgeProcessFixture> = {},
): HouseholdPurgeProcessFixture => ({
  householdId,
  householdState: "deleted",
  claimPageSize: 2,
  claims,
  contextDataDigests,
  ...overrides,
});

async function requestPurge(subject: HouseholdPurgeProcessContractSubject) {
  const result = await subject.requestPermanentHouseholdPurge(purgeAdmin, {
    householdId,
    confirmation: "복구 불가능 영구 삭제 확인",
    expectedVersion: 8,
    idempotencyKey: "request-permanent-purge",
  });
  expect(result).toEqual({ kind: "accepted", processId: expect.any(String) });
  if (result.kind !== "accepted") {
    throw new Error("테스트 준비용 purge 요청이 실패했습니다.");
  }
  return result.processId;
}

describe("가구 영구 purge 내부 system process 공개 계약", () => {
  it("[T-ADM-002][ADM-003/DEC-040] 영구 삭제 capability가 없는 외부 관리자는 Process를 시작하지 못한다", async () => {
    const subject = createSubject(fixture());
    const before = await subject.snapshot();

    await expect(
      subject.requestPermanentHouseholdPurge(
        {
          principalRef: "read-only-operator",
          capabilities: ["household.purge.read"],
        },
        {
          householdId,
          confirmation: "복구 불가능 확인",
          expectedVersion: 8,
          idempotencyKey: "unauthorized-purge",
        },
      ),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "PERMANENT_PURGE_CAPABILITY_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-ADM-002][ADM-003/DEC-016] active 가구는 영구 purge 요청을 거부하고 어떤 데이터도 바꾸지 않는다", async () => {
    const subject = createSubject(fixture({ householdState: "active" }));
    const before = await subject.snapshot();

    await expect(
      subject.requestPermanentHouseholdPurge(purgeAdmin, {
        householdId,
        confirmation: "복구 불가능 확인",
        expectedVersion: 8,
        idempotencyKey: "active-household-purge",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "HOUSEHOLD_MUST_BE_DELETED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(subject.participantCalls()).toEqual([]);
  });

  it("[T-ADM-002][ADM-003/DEC-040] 별도 확인과 현재 version을 모두 검증한 뒤에만 purging으로 전환한다", async () => {
    const missingConfirmation = createSubject(fixture());
    await expect(
      missingConfirmation.requestPermanentHouseholdPurge(purgeAdmin, {
        householdId,
        confirmation: "   ",
        expectedVersion: 8,
        idempotencyKey: "blank-confirmation",
      }),
    ).resolves.toEqual({
      kind: "validation-error",
      code: "PURGE_CONFIRMATION_REQUIRED",
    });
    expect((await missingConfirmation.snapshot()).householdState).toBe(
      "deleted",
    );

    const staleVersion = createSubject(fixture());
    await expect(
      staleVersion.requestPermanentHouseholdPurge(purgeAdmin, {
        householdId,
        confirmation: "복구 불가능 확인",
        expectedVersion: 7,
        idempotencyKey: "stale-purge-request",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "VERSION_MISMATCH",
      currentVersion: 8,
    });
    expect((await staleVersion.snapshot()).householdState).toBe("deleted");
  });

  it("[T-ADM-002][ADM-003] 동일 영구 삭제 요청은 같은 Process를 재생하고 같은 key의 다른 payload는 충돌한다", async () => {
    const subject = createSubject(fixture());
    const input = {
      householdId,
      confirmation: "복구 불가능 영구 삭제 확인",
      expectedVersion: 8,
      idempotencyKey: "idempotent-purge-request",
    };

    const first = await subject.requestPermanentHouseholdPurge(
      purgeAdmin,
      input,
    );
    await expect(
      subject.requestPermanentHouseholdPurge(purgeAdmin, input),
    ).resolves.toEqual(first);
    await expect(
      subject.requestPermanentHouseholdPurge(purgeAdmin, {
        ...input,
        confirmation: "서로 다른 확인 정보",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) =>
          eventType === "HouseholdPermanentPurgeRequested.v1",
      ),
    ).toHaveLength(1);
    expect(subject.participantCalls()).toEqual([]);
  });

  it("[T-ADM-002][ADM-003/DEC-040] claim snapshot의 모든 page가 끝나기 전에는 Context purge를 호출하거나 claim을 해제하지 않는다", async () => {
    const subject = createSubject(fixture());
    const processId = await requestPurge(subject);

    const firstPage = await subject.runHouseholdPurgeProcess(
      purgeSystem,
      processId,
    );
    expect(firstPage).toEqual({
      kind: "progressed",
      processId,
      phase: "claim-snapshot",
      checkpoint: expect.any(String),
    });
    expect(subject.participantCalls()).toEqual([]);
    expect((await subject.snapshot()).currentClaims).toEqual(claims);

    const secondPage = await subject.runHouseholdPurgeProcess(
      purgeSystem,
      processId,
    );
    expect(secondPage).toEqual({
      kind: "progressed",
      processId,
      phase: "claim-snapshot",
      checkpoint: expect.any(String),
    });
    const state = await subject.snapshot();
    expect(state.process?.snapshotEntryCount).toBe(3);
    expect(subject.participantCalls()).toEqual([]);
    expect(state.currentClaims).toEqual(claims);
  });

  it("[T-ADM-002][ADM-003/DEC-040] Context의 PageProcessed만 opaque checkpoint를 전진시키고 완료 전 데이터 지문을 보존한다", async () => {
    const subject = createSubject(
      fixture({
        claims: [claims[0]],
        participantPageCounts: { "household-finance": 2 },
      }),
    );
    const processId = await requestPurge(subject);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({
      kind: "progressed",
      processId,
      phase: "context-purge",
      checkpoint: "household-finance:page:1",
    });
    expect(
      (await subject.snapshot()).contextDataDigests["household-finance"],
    ).toBe("finance-data");

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({
      kind: "progressed",
      processId,
      phase: "context-purge",
      checkpoint: "household-finance:complete",
    });
    expect(
      (await subject.snapshot()).contextDataDigests["household-finance"],
    ).toBeUndefined();
    expect(subject.participantCalls().slice(0, 2)).toEqual([
      expect.objectContaining({
        checkpoint: "household-finance:start",
        result: "page-processed",
      }),
      expect.objectContaining({
        checkpoint: "household-finance:page:1",
        result: "purge-completed",
      }),
    ]);
  });

  it("[T-ADM-002][ADM-003/DEC-040] 같은 Process runner의 동시 실행은 lease 경계에서 직렬화되어 같은 Context page를 중복 호출하지 않는다", async () => {
    const subject = createSubject(fixture({ claims: [claims[0]] }));
    const processId = await requestPurge(subject);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);

    const results = await Promise.all([
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ kind: "progressed", phase: "context-purge" }),
      expect.objectContaining({ kind: "progressed", phase: "context-purge" }),
    ]);
    expect(subject.participantCalls()).toEqual([
      expect.objectContaining({
        participant: "household-finance",
        checkpoint: "household-finance:start",
      }),
      expect.objectContaining({
        participant: "payment-capture",
        checkpoint: "payment-capture:start",
      }),
    ]);
    expect((await subject.snapshot()).currentClaims).toEqual([claims[0]]);
  });

  it("[T-ADM-002][ADM-003/DEC-040] snapshot·Context 일시 실패는 같은 checkpoint에서 재개하고 모든 Context 완료 전 claim을 유지한다", async () => {
    const snapshotFailure = createSubject(
      fixture({
        claims: [claims[0]],
        failOnce: { phase: "claim-snapshot", checkpoint: "snapshot:start" },
      }),
    );
    const snapshotProcessId = await requestPurge(snapshotFailure);
    await expect(
      snapshotFailure.runHouseholdPurgeProcess(
        purgeSystem,
        snapshotProcessId,
      ),
    ).rejects.toThrow("STORE_UNAVAILABLE");
    expect(snapshotFailure.participantCalls()).toEqual([]);
    expect((await snapshotFailure.snapshot()).currentClaims).toEqual([
      claims[0],
    ]);
    await expect(
      snapshotFailure.runHouseholdPurgeProcess(
        purgeSystem,
        snapshotProcessId,
      ),
    ).resolves.toMatchObject({ kind: "progressed", phase: "claim-snapshot" });

    const contextFailure = createSubject(
      fixture({
        claims: [claims[0]],
        failOnce: {
          phase: "context-purge",
          participant: "notifications",
          checkpoint: "notifications:start",
        },
      }),
    );
    const processId = await requestPurge(contextFailure);
    await contextFailure.runHouseholdPurgeProcess(purgeSystem, processId);
    for (const _participant of participants.slice(0, 3)) {
      await contextFailure.runHouseholdPurgeProcess(purgeSystem, processId);
    }
    await expect(
      contextFailure.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({
      kind: "retryable-failure",
      processId,
      phase: "context-purge",
      participant: "notifications",
      checkpoint: "notifications:start",
      code: "PARTICIPANT_UNAVAILABLE",
    });
    expect((await contextFailure.snapshot()).currentClaims).toEqual([
      claims[0],
    ]);

    await expect(
      contextFailure.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toMatchObject({ kind: "progressed", phase: "context-purge" });
    await contextFailure.runHouseholdPurgeProcess(purgeSystem, processId);
    expect((await contextFailure.snapshot()).currentClaims).toEqual([
      claims[0],
    ]);
    const calls = contextFailure.participantCalls();
    expect(
      calls.filter(({ participant }) => participant === "household-finance"),
    ).toHaveLength(1);
    expect(
      calls.filter(({ participant }) => participant === "notifications"),
    ).toEqual([
      expect.objectContaining({ result: "retryable-failure" }),
      expect.objectContaining({ result: expect.stringMatching(/processed|completed/) }),
    ]);
  });

  it("[T-ADM-002][ADM-003/DEC-040] 모든 Context 뒤 snapshot과 같은 claim만 page 해제하고 absent·changed claim은 안전하게 보존 처리한 뒤 한 번만 purged가 된다", async () => {
    const subject = createSubject(fixture());
    const processId = await requestPurge(subject);

    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    for (const _participant of participants) {
      await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    }
    expect((await subject.snapshot()).currentClaims).toEqual(claims);

    subject.removeCurrentClaimForTest("claim-b");
    subject.replaceCurrentClaimForTest("claim-c", {
      principalRef: "principal-c",
      householdId: "different-household",
      membershipId: "different-membership",
      version: 9,
    });

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toMatchObject({
      kind: "progressed",
      phase: "claim-finalization",
    });
    expect((await subject.snapshot()).householdState).toBe("purging");
    expect(await subject.publishedEvents()).toEqual([
      expect.objectContaining({
        eventType: "HouseholdPermanentPurgeRequested.v1",
      }),
    ]);

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({ kind: "completed", processId });
    const finalState = await subject.snapshot();
    expect(finalState.householdState).toBe("purged");
    expect(finalState.currentClaims).toEqual([
      {
        claimRef: "claim-c",
        principalRef: "principal-c",
        householdId: "different-household",
        membershipId: "different-membership",
        version: 9,
      },
    ]);
    expect(finalState.process).toMatchObject({
      phase: "completed",
      releasedClaimCount: 1,
      absentClaimCount: 1,
      claimConflicts: [
        { claimRef: "claim-c", reason: "CURRENT_CLAIM_CHANGED" },
      ],
    });
    await expect(
      subject.getHouseholdPurgeStatus(purgeAdmin, processId),
    ).resolves.toEqual({
      kind: "Success",
      value: {
        processId,
        householdState: "purged",
        phase: "completed",
        completedParticipants: participants,
        releasedClaimCount: 1,
        absentClaimCount: 1,
        claimConflictCount: 1,
      },
    });
    expect(
      Object.values(finalState.contextDataDigests).every(
        (digest) => digest === undefined,
      ),
    ).toBe(true);
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) => eventType === "HouseholdPurged.v1",
      ),
    ).toHaveLength(1);
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) => eventType === "HouseholdPurged.v1",
      ),
    ).toEqual([
      {
        eventType: "HouseholdPurged.v1",
        householdIdHash: "hash:21",
        processId,
        purgedAt: "2026-07-21T00:00:00.000Z",
        releasedClaimCount: 1,
      },
    ]);

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({ kind: "already-completed", processId });
    expect(
      (await subject.publishedEvents()).filter(
        ({ eventType }) => eventType === "HouseholdPurged.v1",
      ),
    ).toHaveLength(1);
  });

  it("[T-ADM-002][ADM-003/DEC-040] claim finalization 중단은 완료 page를 되돌리지 않고 같은 checkpoint에서 재개한다", async () => {
    const subject = createSubject(
      fixture({
        failOnce: {
          phase: "claim-finalization",
          checkpoint: "finalization:2",
        },
      }),
    );
    const processId = await requestPurge(subject);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    for (const _participant of participants) {
      await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    }

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({
      kind: "progressed",
      processId,
      phase: "claim-finalization",
      checkpoint: "finalization:2",
    });
    const afterCompletedPage = await subject.snapshot();
    expect(afterCompletedPage.process).toMatchObject({
      releasedClaimCount: 2,
      absentClaimCount: 0,
    });
    expect(afterCompletedPage.currentClaims).toEqual([claims[2]]);

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).rejects.toThrow("STORE_UNAVAILABLE");
    expect(await subject.snapshot()).toEqual(afterCompletedPage);

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual({ kind: "completed", processId });
    expect((await subject.snapshot()).process).toMatchObject({
      releasedClaimCount: 3,
      phase: "completed",
    });
  });

  it("[T-ADM-002][ADM-003/DEC-040] Context 영구 실패는 해당 checkpoint와 claim을 보존하고 운영 충돌로 노출한다", async () => {
    const subject = createSubject(
      fixture({
        claims: [claims[0]],
        permanentFailure: {
          participant: "portfolio",
          checkpoint: "portfolio:start",
        },
      }),
    );
    const processId = await requestPurge(subject);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    await subject.runHouseholdPurgeProcess(purgeSystem, processId);
    const beforeFailure = await subject.snapshot();

    const expected = {
      kind: "operational-conflict",
      processId,
      phase: "context-purge",
      checkpoint: "portfolio:start",
      participant: "portfolio",
      code: "PARTICIPANT_PERMANENT_FAILURE",
    } as const;
    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual(expected);
    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, processId),
    ).resolves.toEqual(expected);

    const afterFailure = await subject.snapshot();
    expect(afterFailure.currentClaims).toEqual([claims[0]]);
    expect(afterFailure.contextDataDigests.portfolio).toBe("portfolio-data");
    expect(afterFailure.process?.contextStatuses.portfolio).toBe("pending");
    expect(afterFailure.householdState).toBe("purging");
    expect(beforeFailure.currentClaims).toEqual(afterFailure.currentClaims);
  });

  it("[T-ADM-002][ADM-003] 외부 사용자 capability로 내부 purge runner를 호출할 수 없다", async () => {
    const subject = createSubject(fixture({ claims: [claims[0]] }));
    const processId = await requestPurge(subject);
    const before = await subject.snapshot();

    await expect(
      subject.runHouseholdPurgeProcess(
        { systemRef: "user-command", capabilities: [] },
        processId,
      ),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "PURGE_SYSTEM_CAPABILITY_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(subject.participantCalls()).toEqual([]);
  });

  it("[T-ADM-002][ADM-003] purge 상태 조회는 별도 read capability를 요구하고 존재하지 않는 Process를 구분한다", async () => {
    const subject = createSubject(fixture());
    const processId = await requestPurge(subject);

    await expect(
      subject.getHouseholdPurgeStatus(
        {
          principalRef: "write-only-operator",
          capabilities: ["household.purge.permanent"],
        },
        processId,
      ),
    ).resolves.toEqual({
      kind: "Forbidden",
      code: "PURGE_READ_CAPABILITY_REQUIRED",
    });
    await expect(
      subject.getHouseholdPurgeStatus(purgeAdmin, "missing-process"),
    ).resolves.toEqual({ kind: "NotFound" });
  });

  it("[T-ADM-002][ADM-003] 내부 runner도 존재하지 않는 processId를 안전하게 거부한다", async () => {
    const subject = createSubject(fixture());

    await expect(
      subject.runHouseholdPurgeProcess(purgeSystem, "missing-process"),
    ).resolves.toEqual({
      kind: "not-found",
      code: "PURGE_PROCESS_NOT_FOUND",
    });
    expect(await subject.snapshot()).toEqual(await createSubject(fixture()).snapshot());
    expect(subject.participantCalls()).toEqual([]);
  });
});
