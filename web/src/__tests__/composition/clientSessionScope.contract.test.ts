import {
  clearClientSessionScope,
  getClientSessionScope,
  requireClientSessionScope,
  setClientSessionScope,
} from '@/composition/clientSessionScope';

describe('ClientSessionScope', () => {
  afterEach(clearClientSessionScope);

  test('서버가 확인한 세션 record를 한 번에 교체하고 외부 변경을 허용하지 않는다', () => {
    const scope = {
      sessionGeneration: 3,
      principalUid: 'uid-1',
      householdId: 'household-1',
      memberId: 'member-1',
    };
    setClientSessionScope(scope);
    scope.householdId = 'mutated-after-set';

    expect(getClientSessionScope()).toEqual({
      sessionGeneration: 3,
      principalUid: 'uid-1',
      householdId: 'household-1',
      memberId: 'member-1',
    });
    expect(Object.isFrozen(getClientSessionScope())).toBe(true);
  });

  test('로그아웃 뒤에는 tenant command가 사용할 scope를 반환하지 않는다', () => {
    setClientSessionScope({
      sessionGeneration: 1,
      principalUid: 'uid-1',
      householdId: 'household-1',
      memberId: 'member-1',
    });
    clearClientSessionScope();
    expect(() => requireClientSessionScope()).toThrow(/인증된 가구 세션/);
  });
});
