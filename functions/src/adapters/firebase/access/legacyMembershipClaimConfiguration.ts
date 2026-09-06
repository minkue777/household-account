/** DEC-021: 전환 종료 배포에서 false로 설정하면 UI 후보와 직접 명령을 함께 차단합니다. */
export function legacyMembershipClaimEnabled(): boolean {
  return process.env.LEGACY_MEMBERSHIP_CLAIM_ENABLED !== "false";
}
