import type { HouseholdAdministratorActor } from "./commands/householdCommand";

export const SYSTEM_ADMINISTRATOR_CAPABILITIES = Object.freeze([
  "admin.households.read",
  "admin.households.write",
  "household.delete",
  "household.restore",
  "admin.asset-owner-profile.archive",
  "admin.household-members.remove",
  "admin.household-members.restore",
  "portfolio.asset.restore.deleted",
  "portfolio.asset.restore.read",
] as const);

/**
 * Firebase가 서명 검증한 ID token claim만 관리자 신뢰 근거로 사용합니다.
 * 이메일이나 클라이언트가 보낸 capability 배열은 이 경계에 들어오지 않습니다.
 */
export function verifiedSystemAdministrator(
  principalUid: string | undefined,
  verifiedTokenClaims: Readonly<Record<string, unknown>> | undefined,
): HouseholdAdministratorActor | undefined {
  if (
    principalUid === undefined ||
    principalUid.trim() === "" ||
    verifiedTokenClaims?.systemAdmin !== true
  ) {
    return undefined;
  }
  return {
    principalRef: principalUid.trim(),
    capabilities: SYSTEM_ADMINISTRATOR_CAPABILITIES,
  };
}
