jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ runtime: 'default-auth' })),
  initializeAuth: jest.fn(() => ({ runtime: 'android-persistent-auth' })),
  browserLocalPersistence: { type: 'LOCAL' },
  signInWithPopup: jest.fn(),
  signInWithCustomToken: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signOut: jest.fn(async () => undefined),
  onAuthStateChanged: jest.fn(),
}));
jest.mock('@/lib/firebaseApp', () => ({ app: { name: 'web-app' } }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
  requestAndroidHost: jest.fn(),
}));

import {
  getAuth,
  initializeAuth,
  signOut,
  signInWithCustomToken,
} from 'firebase/auth';
import { requestAndroidHost } from '@/platform/android-host/androidHostBridge';
import {
  logOut,
  refreshAndroidWebAuth,
  restoreAndroidHostAuth,
} from '@/lib/authService';

describe('Android WebView auth bootstrap contract', () => {
  it('native 세션을 custom token으로 교환하고 다음 실행을 위해 WebView 세션을 영속화한다', async () => {
    const user = { uid: 'uid-1' };
    const signedInUserResolution = {
      kind: 'membership-found' as const,
      membership: {
        householdId: 'household-1',
        memberId: 'member-1',
        displayName: '민규',
        aggregateVersion: 3,
        status: 'active' as const,
        capabilities: ['household.read'],
      },
    };
    jest.mocked(requestAndroidHost).mockResolvedValue({
      customToken: 'custom-token',
      principalUid: 'uid-1',
      signedInUserResolution,
    });
    jest.mocked(signInWithCustomToken).mockResolvedValue({ user } as never);

    await expect(restoreAndroidHostAuth()).resolves.toEqual({
      user,
      signedInUserResolution,
    });

    expect(initializeAuth).toHaveBeenCalledWith(
      { name: 'web-app' },
      { persistence: { type: 'LOCAL' } }
    );
    expect(getAuth).not.toHaveBeenCalled();
    expect(requestAndroidHost).toHaveBeenCalledWith('auth.sign-in', {});
    expect(signInWithCustomToken).toHaveBeenCalledWith(
      { runtime: 'android-persistent-auth' },
      'custom-token'
    );
  });

  it('영속 Web Auth 토큰이 유효하면 Native 교환 없이 갱신한다', async () => {
    const nativeRequestCount = jest.mocked(requestAndroidHost).mock.calls.length;
    const user = {
      uid: 'uid-1',
      getIdToken: jest.fn().mockResolvedValue('fresh-id-token'),
    };

    await expect(refreshAndroidWebAuth(user as never)).resolves.toEqual({ user });

    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(requestAndroidHost).toHaveBeenCalledTimes(nativeRequestCount);
  });

  it('영속 Web Auth 토큰 갱신이 실패하면 Native 세션으로 자동 복구한다', async () => {
    const user = {
      uid: 'uid-1',
      getIdToken: jest.fn().mockRejectedValue(new Error('expired refresh token')),
    };
    jest.mocked(requestAndroidHost).mockResolvedValue({
      customToken: 'custom-token',
    });
    jest.mocked(signInWithCustomToken).mockResolvedValue({
      user: { uid: 'uid-1' },
    } as never);

    await expect(refreshAndroidWebAuth(user as never)).resolves.toEqual({
      user: { uid: 'uid-1' },
    });
    expect(requestAndroidHost).toHaveBeenCalledWith('auth.sign-in', {});
  });

  it('구버전 token-only 응답은 Membership 별도 조회를 위한 fallback 세션으로 허용한다', async () => {
    const user = { uid: 'uid-1' };
    jest.mocked(requestAndroidHost).mockResolvedValue({ customToken: 'custom-token' });
    jest.mocked(signInWithCustomToken).mockResolvedValue({ user } as never);

    await expect(restoreAndroidHostAuth()).resolves.toEqual({ user });
  });

  it('custom token의 uid와 함께 전달된 Membership principal이 다르면 세션을 폐기한다', async () => {
    const user = { uid: 'uid-1' };
    jest.mocked(requestAndroidHost).mockResolvedValue({
      customToken: 'custom-token',
      principalUid: 'uid-other',
      signedInUserResolution: {
        kind: 'first-visit-required',
        choices: ['create', 'join'],
      },
    });
    jest.mocked(signInWithCustomToken).mockResolvedValue({ user } as never);

    await expect(restoreAndroidHostAuth()).rejects.toThrow(
      'Android 인증 세션과 Membership 해석 결과가 일치하지 않습니다.'
    );
    expect(signOut).toHaveBeenCalledWith({ runtime: 'android-persistent-auth' });
  });

  it('Native endpoint 정리 실패와 무관하게 Web 영속 인증을 제거한다', async () => {
    jest.mocked(requestAndroidHost).mockRejectedValueOnce(new Error('endpoint unavailable'));
    jest.mocked(signOut).mockResolvedValueOnce(undefined);

    await expect(logOut()).rejects.toThrow('endpoint unavailable');

    expect(requestAndroidHost).toHaveBeenCalledWith('auth.sign-out', {});
    expect(signOut).toHaveBeenCalledWith({ runtime: 'android-persistent-auth' });
  });
});
