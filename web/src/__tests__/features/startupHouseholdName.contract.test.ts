import { ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY } from '@/features/access-household/application/adminHouseholdViewSelection';
import { SIGNED_IN_MEMBERSHIP_STORAGE_KEY, writeSignedInMembershipCache } from '@/features/access-household/application/signedInMembershipCache';
import { readStartupHouseholdName, STARTUP_HOUSEHOLD_NAME_SCRIPT } from '@/features/access-household/application/startupHouseholdName';

function remember(name: string) {
  writeSignedInMembershipCache('uid-1', {
    kind: 'membership-found',
    membership: { householdId: 'household-1', memberId: 'member-1', displayName: '사용자', aggregateVersion: 1, status: 'active', capabilities: [] },
    household: { id: 'household-1', name, createdAt: '2026-10-15T00:00:00.000Z', members: [] },
  });
}

describe('[T-LED-001] hydration 이전 가구명 표시', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '<h1 class="startup-title"><span></span><span></span></h1>';
  });

  it.each(['또니망고네', '익태송희네', '함께 쓰는 가계부', '<img src=x onerror=alert(1)>네'])('저장된 %s를 HTML 해석 없이 실제 문자로 먼저 표시한다', name => {
    remember(name);
    expect(readStartupHouseholdName()).toBe(name);
    expect(STARTUP_HOUSEHOLD_NAME_SCRIPT).not.toContain(name);
    window.eval(STARTUP_HOUSEHOLD_NAME_SCRIPT);
    expect(document.querySelector('h1')?.textContent).toBe(name);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelectorAll('h1 > span')).toHaveLength(2);
    expect(document.querySelector('h1 > span:last-child')?.textContent).toBe(name.endsWith('네') ? '네' : '');
  });

  it('로그아웃·손상·다른 가구 ID·탈퇴 Membership·알 수 없는 저장 형식에는 표시하지 않는다', () => {
    remember('또니망고네');
    const stored = JSON.parse(localStorage.getItem(SIGNED_IN_MEMBERSHIP_STORAGE_KEY)!);
    for (const value of [null, '{broken', JSON.stringify({ ...stored, version: 99 }),
      JSON.stringify({ ...stored, resolution: { ...stored.resolution, household: { ...stored.resolution.household, id: 'other' } } }),
      JSON.stringify({ ...stored, resolution: { ...stored.resolution, membership: { ...stored.resolution.membership, status: 'inactive' } } })]) {
      if (value === null) localStorage.removeItem(SIGNED_IN_MEMBERSHIP_STORAGE_KEY);
      else localStorage.setItem(SIGNED_IN_MEMBERSHIP_STORAGE_KEY, value);
      expect(readStartupHouseholdName()).toBe('');
      window.eval(STARTUP_HOUSEHOLD_NAME_SCRIPT);
      expect(document.querySelector('h1')?.textContent).toBe('');
    }
  });

  it('관리자 조회 선택이 남아 있거나 저장소가 거부되면 본인 가구명을 노출하지 않는다', () => {
    remember('또니망고네');
    sessionStorage.setItem(ADMIN_HOUSEHOLD_VIEW_STORAGE_KEY, JSON.stringify({ householdId: 'other', householdName: '다른 가구' }));
    expect(readStartupHouseholdName()).toBe('');
    window.eval(STARTUP_HOUSEHOLD_NAME_SCRIPT);
    expect(document.querySelector('h1')?.textContent).toBe('');
    sessionStorage.clear();
    const denied = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    try {
      expect(readStartupHouseholdName()).toBe('');
      expect(() => window.eval(STARTUP_HOUSEHOLD_NAME_SCRIPT)).not.toThrow();
      expect(document.querySelector('h1')?.textContent).toBe('');
    } finally {
      denied.mockRestore();
    }
  });
});
