import {
  clearAdminHouseholdViewSelection,
  readAdminHouseholdViewSelection,
  selectAdminHouseholdView,
} from '@/features/access-household/application/adminHouseholdViewSelection';

describe('관리자 가구 조회 선택', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
  });

  afterEach(clearAdminHouseholdViewSelection);

  test('선택한 가구는 현재 탭 세션에만 보존한다', () => {
    selectAdminHouseholdView({
      householdId: 'household-observed',
      householdName: '관찰 가계부',
    });

    expect(readAdminHouseholdViewSelection()).toEqual({
      householdId: 'household-observed',
      householdName: '관찰 가계부',
    });
    expect(window.localStorage.length).toBe(0);
  });

  test('관리자 화면에서는 과거 조회 선택을 활성 세션으로 사용하지 않는다', () => {
    selectAdminHouseholdView({
      householdId: 'household-observed',
      householdName: '관찰 가계부',
    });
    window.history.replaceState({}, '', '/admin');

    expect(readAdminHouseholdViewSelection()).toBeNull();
  });

  test('손상되거나 허용 형식이 아닌 가구 ID는 제거한다', () => {
    window.sessionStorage.setItem(
      'household-account.admin-household-view.v1',
      JSON.stringify({ householdId: '../other', householdName: '위조' })
    );

    expect(readAdminHouseholdViewSelection()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });
});
