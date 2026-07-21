import { describe, expect, it } from "vitest";

import { createSessionScopeTransitionFixture } from "../../../support/session-scope-transition-fixture";

export interface SessionScopeSnapshot {
  schemaVersion: 1;
  sessionGeneration: string;
  householdId: string;
  memberId: string;
}

export interface AndroidActorBoundState {
  session?: SessionScopeSnapshot;
  quickEditTransactionIds: readonly string[];
  captureObservationIds: readonly string[];
}

export interface SessionMirrorStorageEvidence {
  encryption: "android-keystore-backed";
  snapshotWrite: "atomic";
  keyExportable: false;
  backupEligible: false;
  persistedIdentityFields: readonly ["schemaVersion", "sessionGeneration", "householdId", "memberId"];
}

export type SessionTransitionOutcome =
  | { kind: "Applied"; session: SessionScopeSnapshot }
  | { kind: "Cleared" }
  | {
      kind: "Rejected";
      code: "SESSION_TRANSITION_BLOCKED";
      retainedSession: SessionScopeSnapshot;
    };

export type InterruptedTransitionRecoveryOutcome =
  | { kind: "NoRecoveryNeeded" }
  | {
      kind: "RecoveredFailClosed";
      discardedTargetGeneration: string;
    };

export type LegacyPreferenceMigrationOutcome =
  | { kind: "Migrated"; value: boolean }
  | { kind: "AlreadyStable"; value: boolean }
  | { kind: "NoLegacyValue" };

export interface SessionScopeTransitionContractSubject {
  transitionTo(
    next: SessionScopeSnapshot,
    queuePurgeResult: "success" | "failure",
  ): Promise<SessionTransitionOutcome>;
  logout(
    queuePurgeResult: "success" | "failure",
  ): Promise<SessionTransitionOutcome>;
  recoverInterruptedTransition(): Promise<InterruptedTransitionRecoveryOutcome>;
  migrateLegacyQuickEditPreference(input: {
    householdId: string;
    memberId: string;
    legacyDisplayName: string;
  }): LegacyPreferenceMigrationOutcome;
  quickEditPreferenceFor(input: {
    householdId: string;
    memberId: string;
    currentDisplayName: string;
  }): boolean | undefined;
  storageEvidence(): SessionMirrorStorageEvidence;
  state(): AndroidActorBoundState;
}

export function createSubject(fixture: {
  current: SessionScopeSnapshot;
  quickEditTransactionIds?: readonly string[];
  captureObservationIds?: readonly string[];
  quickEditPreferences?: Readonly<Record<string, boolean>>;
  legacyQuickEditPreferences?: Readonly<Record<string, boolean>>;
  interruptedTransition?: {
    phase: "queues-purged-before-mirror-commit";
    target: SessionScopeSnapshot;
  };
}): SessionScopeTransitionContractSubject {
  return createSessionScopeTransitionFixture(fixture);
}

const oldSession: SessionScopeSnapshot = {
  schemaVersion: 1,
  sessionGeneration: "generation-old",
  householdId: "household-old",
  memberId: "member-old",
};

const newSession: SessionScopeSnapshot = {
  schemaVersion: 1,
  sessionGeneration: "generation-new",
  householdId: "household-new",
  memberId: "member-new",
};

const fixture = () => ({
  current: oldSession,
  quickEditTransactionIds: ["transaction-old"],
  captureObservationIds: ["observation-old"],
});

describe("Android SessionScope 원자 전환 공개 계약", () => {
  it("[T-SESSION-MIRROR-001][AND-011][QE-009][ING-008] 가구·멤버 전환은 이전 actor의 두 Queue를 비운 뒤 새 snapshot 전체를 적용한다", async () => {
    const subject = createSubject(fixture());

    expect(await subject.transitionTo(newSession, "success")).toEqual({
      kind: "Applied",
      session: newSession,
    });
    expect(subject.state()).toEqual({
      session: newSession,
      quickEditTransactionIds: [],
      captureObservationIds: [],
    });
  });

  it("[T-SESSION-MIRROR-001][AND-011] 이전 actor Queue 삭제에 실패하면 새 actor를 일부라도 적용하지 않고 기존 snapshot과 Queue를 모두 유지한다", async () => {
    const subject = createSubject(fixture());

    expect(await subject.transitionTo(newSession, "failure")).toEqual({
      kind: "Rejected",
      code: "SESSION_TRANSITION_BLOCKED",
      retainedSession: oldSession,
    });
    expect(subject.state()).toEqual({
      session: oldSession,
      quickEditTransactionIds: ["transaction-old"],
      captureObservationIds: ["observation-old"],
    });
  });

  it("[T-SESSION-MIRROR-001][AND-011][DEC-032/DEC-054] 로그아웃 성공은 actor snapshot과 이전 scope Queue를 함께 제거한다", async () => {
    const subject = createSubject(fixture());

    expect(await subject.logout("success")).toEqual({ kind: "Cleared" });
    expect(subject.state()).toEqual({
      session: undefined,
      quickEditTransactionIds: [],
      captureObservationIds: [],
    });
  });

  it("[T-SESSION-MIRROR-001][AND-011] 로그아웃 Queue 삭제 실패를 성공으로 숨기지 않고 현재 actor를 유지한다", async () => {
    const subject = createSubject(fixture());

    expect(await subject.logout("failure")).toEqual({
      kind: "Rejected",
      code: "SESSION_TRANSITION_BLOCKED",
      retainedSession: oldSession,
    });
    expect(subject.state()).toEqual({
      session: oldSession,
      quickEditTransactionIds: ["transaction-old"],
      captureObservationIds: ["observation-old"],
    });
  });

  it("[T-SESSION-MIRROR-001][AND-011] QuickEdit 설정은 표시 이름이 아니라 householdId·memberId에 귀속되어 이름 변경 뒤에도 유지된다", () => {
    const subject = createSubject({
      ...fixture(),
      quickEditPreferences: { "household-old/member-old": false },
    });

    expect(
      subject.quickEditPreferenceFor({
        householdId: "household-old",
        memberId: "member-old",
        currentDisplayName: "변경 전 이름",
      }),
    ).toBe(false);
    expect(
      subject.quickEditPreferenceFor({
        householdId: "household-old",
        memberId: "member-old",
        currentDisplayName: "변경 후 이름",
      }),
    ).toBe(false);
    expect(
      subject.quickEditPreferenceFor({
        householdId: "household-old",
        memberId: "다른-member",
        currentDisplayName: "변경 후 이름",
      }),
    ).toBeUndefined();
  });

  it("[T-SESSION-MIRROR-001][AND-011] legacy 표시 이름 설정은 stable householdId·memberId key로 정확히 한 번 이관한다", () => {
    const subject = createSubject({
      ...fixture(),
      quickEditPreferences: {},
      legacyQuickEditPreferences: { "변경 전 이름": false },
    });

    expect(
      subject.migrateLegacyQuickEditPreference({
        householdId: "household-old",
        memberId: "member-old",
        legacyDisplayName: "변경 전 이름",
      }),
    ).toEqual({ kind: "Migrated", value: false });
    expect(
      subject.quickEditPreferenceFor({
        householdId: "household-old",
        memberId: "member-old",
        currentDisplayName: "변경 후 이름",
      }),
    ).toBe(false);
    expect(
      subject.migrateLegacyQuickEditPreference({
        householdId: "household-old",
        memberId: "member-old",
        legacyDisplayName: "변경 전 이름",
      }),
    ).toEqual({ kind: "AlreadyStable", value: false });
  });

  it("[T-SESSION-MIRROR-001][AND-011] Queue purge 뒤 mirror commit 전에 process가 중단되면 재시작 시 어느 Actor도 활성화하지 않는 fail-closed 상태로 복구한다", async () => {
    const subject = createSubject({
      current: oldSession,
      quickEditTransactionIds: [],
      captureObservationIds: [],
      interruptedTransition: {
        phase: "queues-purged-before-mirror-commit",
        target: newSession,
      },
    });

    expect(await subject.recoverInterruptedTransition()).toEqual({
      kind: "RecoveredFailClosed",
      discardedTargetGeneration: "generation-new",
    });
    expect(subject.state()).toEqual({
      session: undefined,
      quickEditTransactionIds: [],
      captureObservationIds: [],
    });
  });

  it("[T-SESSION-MIRROR-001][AND-011][DEC-032] mirror는 한 암호화 snapshot으로만 저장되고 key·identity를 backup으로 내보내지 않는다", () => {
    const subject = createSubject(fixture());

    expect(subject.storageEvidence()).toEqual({
      encryption: "android-keystore-backed",
      snapshotWrite: "atomic",
      keyExportable: false,
      backupEligible: false,
      persistedIdentityFields: [
        "schemaVersion",
        "sessionGeneration",
        "householdId",
        "memberId",
      ],
    });
  });

  it("중단된 전환이 없으면 복구가 현재 actor 상태를 변경하지 않는다", async () => {
    const subject = createSubject(fixture());

    expect(await subject.recoverInterruptedTransition()).toEqual({
      kind: "NoRecoveryNeeded",
    });
    expect(subject.state()).toEqual({
      session: oldSession,
      quickEditTransactionIds: ["transaction-old"],
      captureObservationIds: ["observation-old"],
    });
  });

  it("legacy 이름 설정이 없으면 stable 설정을 임의 생성하지 않는다", () => {
    const subject = createSubject(fixture());

    expect(
      subject.migrateLegacyQuickEditPreference({
        householdId: "household-old",
        memberId: "member-old",
        legacyDisplayName: "존재하지 않는 이름",
      }),
    ).toEqual({ kind: "NoLegacyValue" });
    expect(
      subject.quickEditPreferenceFor({
        householdId: "household-old",
        memberId: "member-old",
        currentDisplayName: "현재 이름",
      }),
    ).toBeUndefined();
  });

  it("stable 설정이 이미 있으면 같은 이름의 legacy 값보다 stable 값을 우선한다", () => {
    const subject = createSubject({
      ...fixture(),
      quickEditPreferences: { "household-old/member-old": true },
      legacyQuickEditPreferences: { "변경 전 이름": false },
    });

    expect(
      subject.migrateLegacyQuickEditPreference({
        householdId: "household-old",
        memberId: "member-old",
        legacyDisplayName: "변경 전 이름",
      }),
    ).toEqual({ kind: "AlreadyStable", value: true });
  });

});
