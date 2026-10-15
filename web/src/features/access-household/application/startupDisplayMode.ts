import { ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY } from './adminHouseholdViewSelection';

/** 표시만 구분합니다. 관리자 권한과 조회 범위는 기존 인증 경로가 검증합니다. */
export function readStartupDisplayMode(adminKey = ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY): 'admin' | 'brand' {
  try {
    const path = window.location.pathname;
    return path === '/admin' || path.startsWith('/admin/') || window.sessionStorage.getItem(adminKey) !== null
      ? 'admin' : 'brand';
  } catch {
    return 'brand';
  }
}
