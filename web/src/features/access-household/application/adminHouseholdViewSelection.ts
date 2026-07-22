const STORAGE_KEY = 'household-account.admin-household-view.v1';

export interface AdminHouseholdViewSelection {
  householdId: string;
  householdName: string;
}

function isStableHouseholdId(value: unknown): value is string {
  return (
    typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
  );
}

function parseSelection(value: unknown): AdminHouseholdViewSelection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isStableHouseholdId(candidate.householdId)
    || typeof candidate.householdName !== 'string'
    || candidate.householdName.trim() === ''
    || candidate.householdName.length > 200
  ) {
    return null;
  }
  return {
    householdId: candidate.householdId,
    householdName: candidate.householdName.trim(),
  };
}

export function selectAdminHouseholdView(selection: AdminHouseholdViewSelection): void {
  const parsed = parseSelection(selection);
  if (parsed === null) throw new Error('관리자 조회 대상 가구가 올바르지 않습니다.');
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}

export function readAdminHouseholdViewSelection(): AdminHouseholdViewSelection | null {
  if (typeof window === 'undefined' || window.location.pathname.startsWith('/admin')) {
    return null;
  }
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = parseSelection(JSON.parse(raw));
    if (parsed !== null) return parsed;
  } catch {
    // 아래에서 손상된 선택값을 제거합니다.
  }
  window.sessionStorage.removeItem(STORAGE_KEY);
  return null;
}

export function clearAdminHouseholdViewSelection(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(STORAGE_KEY);
}
