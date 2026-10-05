import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { createNotificationHouseholdCommandHandlers } from "../../../src/bootstrap/commands/notificationHouseholdCommandHandlers";
import type { HouseholdCommandActor } from "../../../src/bootstrap/commands/householdCommand";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

const actor: HouseholdCommandActor = { principalUid: "uid-1", householdId: "house-1", actingMemberId: "member-1", capabilities: ["household.write"] };
function subject() {
  const memory = new InMemoryFirestore();
  const handlers = createNotificationHouseholdCommandHandlers(memory as unknown as Firestore);
  let sequence = 0;
  const execute = (name: string, payload: Record<string, unknown>, currentActor: HouseholdCommandActor | null = actor) =>
    handlers.get(`notifications.${name}-endpoint.v1`)!.execute({
      principalUid: currentActor?.principalUid ?? "uid", actor: currentActor ?? undefined, requestedAt: "2026-10-05T00:00:00.000Z",
      envelope: { contractVersion: "household-command.v1", command: `notifications.${name}-endpoint.v1`, commandId: `command-${++sequence}`,
        idempotencyKey: `key-${sequence}`, householdId: currentActor?.householdId, payload },
    }) as Promise<{ kind: string; endpointId: string; registrationVersion: number; result?: string }>;
  const register = (fid: string, currentActor = actor, platform = "android") => execute("register", { fid, platform, deviceInfo: { model: "phone" } }, currentActor);
  return { memory, execute, register, endpoint: (id: string) => memory.document(`notificationEndpoints/${id}`) };
}

describe("검증된 요청의 모바일 설치 등록 명령", () => {
  it("[T-PUSH-008][PUSH-002/PUSH-003] 검증 actor가 없거나 빈 FID·지원하지 않는 플랫폼·임의 metadata이면 저장하지 않는다", async () => {
    const value = subject();
    await expect(value.execute("register", { fid: "fid", platform: "android" }, null)).rejects.toMatchObject({ code: "HOUSEHOLD_FORBIDDEN" });
    await expect(value.register(" ")).rejects.toMatchObject({ code: "FID_REQUIRED" });
    await expect(value.register("fid", actor, "desktop")).rejects.toMatchObject({ code: "PLATFORM_NOT_SUPPORTED" });
    await expect(value.execute("register", { fid: "fid", platform: "android", deviceInfo: { secret: "invalid" } })).rejects.toMatchObject({ code: "DEVICE_INFO_INVALID" });
    expect(value.memory.paths("notificationEndpoints/")).toEqual([]);
  });

  it.each(["android", "ios-pwa"])("[T-PUSH-008][PUSH-001/PUSH-002/PUSH-003] %s의 최소 metadata를 저장하며 응답에는 FID를 노출하지 않는다", async platform => {
    const value = subject();
    const result = await value.register("FID-PRIVATE", actor, platform);
    expect(result).toMatchObject({ kind: "registered", registrationVersion: 1, result: "created" });
    expect(JSON.stringify(result)).not.toContain("FID-PRIVATE");
    expect(value.endpoint(result.endpointId)).toMatchObject({ householdId: "house-1", memberId: "member-1", platform,
      status: "active", registrationVersion: 1, bindingVersion: 1, deviceInfo: { model: "phone" } });
    const reinstalled = await value.register("FID-REINSTALLED", actor, platform);
    expect(reinstalled.endpointId).not.toBe(result.endpointId);
    expect(value.memory.paths("notificationEndpoints/")).toHaveLength(2);
  });

  it("[T-PUSH-008][PUSH-003] 현재 버전만 비활성화하고 재등록은 같은 endpoint의 버전을 증가시키며 로그아웃은 해당 설치만 삭제한다", async () => {
    const value = subject();
    const first = await value.register("fid-a");
    const other = await value.register("fid-b");
    expect(await value.execute("remove", { fid: "fid-a", reason: "sdk-unregistered", expectedRegistrationVersion: 1 })).toMatchObject({ kind: "inactivated" });
    expect(value.endpoint(first.endpointId)).toMatchObject({ status: "inactive" });
    expect(await value.register("fid-a")).toMatchObject({ endpointId: first.endpointId, registrationVersion: 2, result: "refreshed" });
    expect(value.endpoint(first.endpointId)).toMatchObject({ status: "active", bindingVersion: 1 });
    expect(value.endpoint(first.endpointId)?.inactiveAt).toBeUndefined();
    expect(value.endpoint(first.endpointId)?.expiresAt).toBeUndefined();
    expect(await value.execute("remove", { fid: "fid-a", reason: "sdk-unregistered", expectedRegistrationVersion: 1 })).toMatchObject({ kind: "stale-ignored" });
    expect(value.endpoint(first.endpointId)).toMatchObject({ status: "active", registrationVersion: 2 });
    expect(await value.execute("remove", { fid: "fid-a", reason: "logout" })).toMatchObject({ kind: "removed" });
    expect(value.endpoint(first.endpointId)).toBeUndefined();
    expect(value.endpoint(other.endpointId)).toMatchObject({ status: "active" });
    expect(await value.execute("remove", { fid: "fid-a", reason: "logout" })).toEqual({ kind: "already-absent" });
  });

  it("[T-PUSH-008][PUSH-002/PUSH-003] 같은 FID의 새 명의 연결 뒤 이전 명의의 늦은 해제는 새 연결을 건드리지 않는다", async () => {
    const value = subject();
    const first = await value.register("fid");
    const nextActor = { ...actor, principalUid: "uid-2", householdId: "house-2", actingMemberId: "member-2" };
    expect(await value.register("fid", nextActor, "ios-pwa")).toMatchObject({ endpointId: first.endpointId, registrationVersion: 2, result: "stale-binding-recovered" });
    const after = value.endpoint(first.endpointId);
    expect(after).toMatchObject({ householdId: "house-2", memberId: "member-2", registrationVersion: 2, bindingVersion: 2 });
    for (const payload of [{ fid: "fid", reason: "logout" }, { fid: "fid", reason: "sdk-unregistered", expectedRegistrationVersion: 2 }]) {
      expect(await value.execute("remove", payload)).toMatchObject({ kind: "stale-ignored" });
      expect(value.endpoint(first.endpointId)).toEqual(after);
    }
  });
});
