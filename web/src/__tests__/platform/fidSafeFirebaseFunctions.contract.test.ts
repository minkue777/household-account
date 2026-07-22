const mockGetFunctions = jest.fn();

jest.mock('firebase/functions', () => ({
  getFunctions: (...args: unknown[]) => mockGetFunctions(...args),
}));

jest.mock('@/lib/firebase', () => ({ app: { name: 'web-app' } }));

import { getFidSafeFirebaseFunctions } from '@/platform/functions-api/fidSafeFirebaseFunctions';

describe('Firebase Callable FID 보존 계약', () => {
  it('Callable 호출 전에 구형 registration token을 만드는 Messaging 연결을 제거한다', () => {
    const functions = {
      contextProvider: {
        messaging: { getToken: jest.fn() },
      },
    };
    mockGetFunctions.mockReturnValue(functions);

    expect(getFidSafeFirebaseFunctions()).toBe(functions);

    expect(mockGetFunctions).toHaveBeenCalledWith(
      { name: 'web-app' },
      'asia-northeast3'
    );
    expect(functions.contextProvider.messaging).toBeUndefined();
  });

  it('Firebase 내부 ContextProvider가 없는 런타임에서도 Callable 인스턴스를 그대로 반환한다', () => {
    const functions = {};
    mockGetFunctions.mockReturnValue(functions);

    expect(getFidSafeFirebaseFunctions()).toBe(functions);
  });
});
