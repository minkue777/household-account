import { ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY } from './adminHouseholdViewSelection';
import { SIGNED_IN_MEMBERSHIP_STORAGE_KEY } from './signedInMembershipCache';

/**
 * 표시용 이름만 읽습니다. 인증 scope를 복원하지 않습니다.
 * 첫 HTML에서도 동일한 함수를 실행하므로 본문은 외부 함수에 의존하지 않습니다.
 */
export function readStartupHouseholdName(
  membershipKey = SIGNED_IN_MEMBERSHIP_STORAGE_KEY,
  adminKey = ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY
): string {
  try {
    // typeof window 분기는 서버 build가 상수화하므로, SSR의 미존재도 이 경계에서 처리합니다.
    // 관리자 조회 대상이 남아 있으면 본인 가구 이름을 먼저 노출하지 않습니다.
    if (window.sessionStorage.getItem(adminKey) !== null) return '';
    const stored = JSON.parse(window.localStorage.getItem(membershipKey) ?? 'null');
    const membership = stored?.resolution?.membership;
    const household = stored?.resolution?.household;
    return [1, 2, 3, 4, 5].includes(stored?.version)
      && typeof stored.principalUid === 'string'
      && stored.resolution?.kind === 'membership-found'
      && membership?.status === 'active'
      && typeof membership.householdId === 'string'
      && membership.householdId.trim() !== ''
      && household?.id === membership.householdId
      && typeof household.name === 'string'
      && household.name.trim() !== ''
      ? household.name : '';
  } catch {
    return '';
  }
}

function paintStartupHouseholdName(readName: () => string): void {
  const title = document.querySelector('.startup-title');
  if (!title) return;
  const name = readName();
  title.children[0].textContent = name.endsWith('네') ? name.slice(0, -1) : name;
  title.children[1].textContent = name.endsWith('네') ? '네' : '';
}

// 사용자 값은 HTML에 포함하지 않습니다. 기기의 기존 cache를 읽고 textContent로만 넣습니다.
export const STARTUP_HOUSEHOLD_NAME_SCRIPT = `(${paintStartupHouseholdName.toString()})(()=>(${readStartupHouseholdName.toString()})(${JSON.stringify(SIGNED_IN_MEMBERSHIP_STORAGE_KEY)},${JSON.stringify(ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY)}))`;
