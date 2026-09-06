import type { Firestore } from "firebase-admin/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";

import { principalClaimId } from "../../src/adapters/firebase/access/firebasePrincipalMembershipClaim";
import { canonicalJson } from '../../src/platform/shared-kernel/canonicalJson';
import {
  FirebaseHouseholdCommandMembershipAdapter,
  FirebaseHouseholdCommandReceiptAdapter,
  Sha256HouseholdCommandHashAdapter,
} from "../../src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import { createAdminAccessRouter } from "../../src/bootstrap/admin/adminAccess";
import { createAdminHouseholdAccessHandlers } from "../../src/bootstrap/admin/handlers/adminHouseholdAccessHandlers";
import { createAccessHouseholdCommandHandlers } from "../../src/bootstrap/commands/accessHouseholdCommandHandlers";
import { createHouseholdCommandRouter } from "../../src/bootstrap/commands/householdCommandRouter";
import { verifiedSystemAdministrator } from "../../src/bootstrap/verifiedSystemAdministrator";
import { STANDARD_MEMBER_CAPABILITIES } from "../../src/contexts/access/google-onboarding/domain/policies/googleOnboardingPolicy";
import { InMemoryFirestore } from "../support/in-memory-firestore";

const now = "2026-09-06T03:00:00.000Z";
const householdId = "security-household";
const principalUid = "security-member";
const memberPath = `households/${householdId}/members/member-a`;
const claimPath = `principalMembershipClaims/${principalClaimId(principalUid)}`;

function fixture() {
  const memory = new InMemoryFirestore();
  memory.seed(`households/${householdId}`, {
    name: "보안 검증", lifecycleState: "active", aggregateVersion: 1, createdAt: now,
  });
  memory.seed(memberPath, {
    linkedPrincipalUid: principalUid, displayName: "사용자", lifecycleState: "active", aggregateVersion: 1,
  });
  memory.seed(`households/${householdId}/memberships/${principalUid}`, {
    principalUid, householdId, memberId: "member-a", lifecycleState: "active",
    capabilities: [...STANDARD_MEMBER_CAPABILITIES, "household.delete"],
  });
  memory.seed(claimPath, {
    principalUid, householdId, memberId: "member-a", lifecycleState: "active",
    householdLifecycleState: "active", capabilities: [...STANDARD_MEMBER_CAPABILITIES, "household.delete"],
  });
  memory.seed(`users/${principalUid}/householdMembershipViews/${householdId}`, {
    householdId, memberId: "member-a", displayName: "사용자", lifecycleState: "active",
  });
  const database = memory as unknown as Firestore;
  const router = createHouseholdCommandRouter({
    handlers: createAccessHouseholdCommandHandlers(database),
    memberships: new FirebaseHouseholdCommandMembershipAdapter(database),
    receipts: new FirebaseHouseholdCommandReceiptAdapter(database),
    hashes: new Sha256HouseholdCommandHashAdapter(),
  });
  const admin = createAdminAccessRouter({ handlers: new Map(createAdminHouseholdAccessHandlers(database)) });
  return {
    memory,
    execute(command: string, payload: Record<string, unknown>, commandId: string, idempotencyKey = commandId) {
      return router.execute({
        principalUid, requestedAt: now,
        request: { contractVersion: "household-command.v1", ...(command === 'access.claim-legacy-membership.v1' ? {} : { householdId }), command, commandId, idempotencyKey, payload },
      });
    },
    admin(operation: string, payload: Record<string, unknown>, id: string) {
      return admin.execute({
        principalUid: "security-admin", administrator: verifiedSystemAdministrator("security-admin", { systemAdmin: true }),
        requestedAt: now,
        request: { contractVersion: "admin-access.v1", operation, requestId: id, idempotencyKey: id, payload },
      });
    },
  };
}

describe("Access 실제 router와 Firebase adapter의 접근·무변경 계약", () => {
  afterEach(() => vi.unstubAllEnvs());

  it('[HH-003] 전환 flag가 꺼지면 직접 legacy claim도 저장 없이 거부한다', async () => {
    vi.stubEnv('LEGACY_MEMBERSHIP_CLAIM_ENABLED', 'false');
    const f = fixture();
    await expect(f.execute('access.claim-legacy-membership.v1', { legacyHouseholdId: householdId, legacyMemberId: 'member-a' }, 'claim-disabled'))
      .resolves.toMatchObject({ kind: 'error', code: 'COMMAND_FAILED', details: { domainCode: 'LEGACY_CLAIM_DISABLED' } });
    expect(f.memory.documentsInCollection('outboxEvents')).toHaveLength(0);
  });

  it('[HH-007] 새로고침 뒤 별도 초기화 재시도 명령도 가구의 고정 key를 사용한다', async () => {
    const f = fixture();
    f.memory.seed(`households/${householdId}`, { ...f.memory.document(`households/${householdId}`), initializationStatus: 'failed' });
    await expect(f.execute('access.retry-household-initialization.v1', {}, 'retry-initialization-1'))
      .resolves.toMatchObject({ kind: 'success', data: { initializationStatus: 'completed' } });
    const categories = f.memory.documentsInCollection('categories');
    expect(categories.length).toBeGreaterThan(0);
    await expect(f.execute('access.retry-household-initialization.v1', {}, 'retry-initialization-2'))
      .resolves.toMatchObject({ kind: 'success', data: { initializationStatus: 'completed' } });
    expect(f.memory.documentsInCollection('categories')).toEqual(categories);
    expect(f.memory.document(`households/${householdId}`)).toMatchObject({ initializationStatus: 'completed' });
  });
  it.each(['completed', 'deleted'] as const)('[HH-007][SYS-007] 늦은 초기화 실패가 동시 %s 결과를 덮어쓰지 않는다', async transition => {
    const f = fixture();
    const path = `households/${householdId}`;
    f.memory.seed(path, { ...f.memory.document(path), initializationStatus: 'failed' });
    vi.spyOn(f.memory, 'recordTransactionRead').mockImplementation(target => {
      if (target.path !== 'categories') return;
      f.memory.seed(path, { ...f.memory.document(path), ...(transition === 'completed'
        ? { initializationStatus: 'completed' } : { lifecycleState: 'deleted', aggregateVersion: 2 }) });
      throw new Error('late failed initialization');
    });
    const result = await f.execute('access.retry-household-initialization.v1', {}, `initialization-race-${transition}`);
    if (transition === 'completed') {
      expect(result).toMatchObject({ kind: 'success', data: { initializationStatus: 'completed' } });
      expect(f.memory.document(path)).toMatchObject({ initializationStatus: 'completed' });
    } else {
      expect(result).toMatchObject({ kind: 'error', details: { domainCode: 'HOUSEHOLD_NOT_ACTIVE' } });
      expect(f.memory.document(path)).toMatchObject({ lifecycleState: 'deleted', initializationStatus: 'failed', aggregateVersion: 2 });
    }
    expect(f.memory.documentsInCollection('categories')).toHaveLength(0);
  });
  it("[HH-007][CAT-001] 기본 카테고리 초기화가 실패해도 생성 graph를 보존하고 같은 생성 key로 초기화만 재시도한다", async () => {
    const memory = new InMemoryFirestore();
    let failures = 0;
    vi.spyOn(memory, "recordTransactionRead").mockImplementation((target) => {
      if (target.path === "categories" && failures++ === 0) throw new Error("category storage unavailable");
    });
    const database = memory as unknown as Firestore;
    const router = createHouseholdCommandRouter({
      handlers: createAccessHouseholdCommandHandlers(database),
      memberships: new FirebaseHouseholdCommandMembershipAdapter(database),
      receipts: new FirebaseHouseholdCommandReceiptAdapter(database),
      hashes: new Sha256HouseholdCommandHashAdapter(),
    });
    const execute = (commandId: string) => router.execute({
      principalUid: "new-principal", requestedAt: now,
      request: {
        contractVersion: "household-command.v1", command: "access.create-household-with-self.v1",
        commandId, idempotencyKey: "create-and-initialize", payload: { householdName: "초기화", memberName: "사용자" },
      },
    });
    const first = await execute("create-attempt-1");
    expect(first).toMatchObject({ kind: "success", data: { initializationStatus: "failed" } });
    const household = memory.documentsInCollection("households")[0];
    expect(household.value).toMatchObject({ lifecycleState: "active", initializationStatus: "failed" });
    const repeated = await execute("create-attempt-2");
    expect(repeated).toMatchObject({ kind: "success", data: { initializationStatus: "completed" } });
    expect(memory.documentsInCollection("households")).toHaveLength(1);
    expect(memory.document(household.path)).toMatchObject({ initializationStatus: "completed" });
    expect(memory.documentsInCollection("categories").length).toBeGreaterThan(0);
    expect(memory.documentsInCollection("outboxEvents").filter((event) => event.value.eventType === "HouseholdCreated")).toHaveLength(1);
  });

  it("[ADM-002][HH-008] 과거 삭제 capability가 남은 일반 사용자도 공개 삭제 명령을 실행할 수 없다", async () => {
    const f = fixture();
    const before = f.memory.document(`households/${householdId}`);
    await expect(f.execute("access.request-household-deletion.v1", {}, "forbidden-delete"))
      .resolves.toMatchObject({ kind: "error", code: "COMMAND_NOT_AVAILABLE" });
    expect(f.memory.document(`households/${householdId}`)).toEqual(before);
    expect(f.memory.documentsInCollection("outboxEvents")).toHaveLength(0);
    expect(STANDARD_MEMBER_CAPABILITIES).not.toContain("household.delete");
  });

  it("[ADM-003][SYS-001] 관리자 삭제가 claim을 같은 transaction에서 차단하고 복구 후에만 일반 명령이 성공한다", async () => {
    const f = fixture();
    await expect(f.admin("delete-household", { householdId, confirmed: true, expectedVersion: 1 }, "admin-delete"))
      .resolves.toMatchObject({ kind: "success" });
    expect(f.memory.document(claimPath)).toMatchObject({ householdLifecycleState: "deleted", lifecycleState: "active" });
    const before = f.memory.document(memberPath);
    await expect(f.execute("access.rename-self.v1", { displayName: "차단 대상", expectedVersion: 1 }, "rename-deleted"))
      .resolves.toMatchObject({ kind: "error", code: "HOUSEHOLD_NOT_ACTIVE" });
    expect(f.memory.document(memberPath)).toEqual(before);
    await expect(f.admin("restore-household", { householdId, reason: "실수 복구", expectedVersion: 2 }, "admin-restore"))
      .resolves.toMatchObject({ kind: "success" });
    expect(f.memory.document(claimPath)).toMatchObject({ householdLifecycleState: "active" });
    await expect(f.execute("access.rename-self.v1", { displayName: "복구 후 변경", expectedVersion: 1 }, "rename-restored"))
      .resolves.toMatchObject({ kind: "success", data: { displayName: "복구 후 변경" } });
  });

  it.each([1, 99])("[HH-009][HH-012] 이름 변경 expectedVersion=%s 결과와 무관하게 제거된 다른 멤버를 변경하지 않는다", async (expectedVersion) => {
    const f = fixture();
    const otherPath = `households/${householdId}/members/removed-member`;
    f.memory.seed(otherPath, {
      linkedPrincipalUid: "removed-user", displayName: "제거된 사용자", lifecycleState: "removed", aggregateVersion: 2,
    });
    f.memory.seed(`households/${householdId}/memberships/removed-user`, { memberId: "removed-member", lifecycleState: "removed" });
    const before = f.memory.document(otherPath);
    const selfBefore = f.memory.document(memberPath);
    const result = await f.execute("access.rename-self.v1", { displayName: "변경", expectedVersion }, `rename-${expectedVersion}`);
    expect(result.kind).toBe(expectedVersion === 1 ? "success" : "error");
    expect(f.memory.document(otherPath)).toEqual(before);
    if (expectedVersion === 99) expect(f.memory.document(memberPath)).toEqual(selfBefore);
  });

  it("[SYS-007] 같은 논리 key의 새 commandId는 재실행 없이 재생하고 다른 payload는 거부한다", async () => {
    const f = fixture();
    const payload = { displayName: "변경", expectedVersion: 1 };
    await expect(f.execute("access.rename-self.v1", payload, "attempt-1", "same-operation"))
      .resolves.toMatchObject({ kind: "success" });
    await expect(f.execute("access.rename-self.v1", payload, "attempt-2", "same-operation"))
      .resolves.toMatchObject({ kind: "success", commandId: "attempt-2", replayed: true });
    expect(f.memory.document(memberPath)).toMatchObject({ aggregateVersion: 2 });
    await expect(f.execute("access.rename-self.v1", { ...payload, displayName: "다른 요청" }, "attempt-3", "same-operation"))
      .resolves.toMatchObject({ kind: "error", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" });
  });

  it('[SYS-007][REL-003] 구형 envelope hash receipt도 원래 commandId로 검증한 뒤 안전하게 재생한다', async () => {
    const f = fixture();
    const hash = new Sha256HouseholdCommandHashAdapter();
    const payload = { displayName: '원래 완료', expectedVersion: 1 };
    const oldEnvelope = { contractVersion: 'household-command.v1', householdId, command: 'access.rename-self.v1', commandId: 'old-command', idempotencyKey: 'old-key', payload };
    f.memory.seed(`commandReceipts/household-command/receipts/${hash.hash(`${principalUid}\u0000old-key`)}`, {
      principalUid, command: oldEnvelope.command, payloadHash: hash.hash(canonicalJson(oldEnvelope)), status: 'completed',
      result: { kind: 'success', commandId: 'old-command', data: { displayName: '원래 완료' } },
    });
    const before = f.memory.document(memberPath);
    await expect(f.execute(oldEnvelope.command, payload, 'new-command', 'old-key')).resolves.toMatchObject({ kind: 'success', commandId: 'new-command', replayed: true });
    expect(f.memory.document(memberPath)).toEqual(before);
    await expect(f.execute(oldEnvelope.command, { ...payload, displayName: '변조' }, 'another-command', 'old-key')).resolves.toMatchObject({ kind: 'error', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  });
});
