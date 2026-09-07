jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ runtime: 'existing-auth' })),
  initializeAuth: jest.fn(() => ({ runtime: 'browser-auth', currentUser: null })),
  indexedDBLocalPersistence: { storage: 'indexedDB', type: 'LOCAL' },
  browserLocalPersistence: { storage: 'localStorage', type: 'LOCAL' },
  browserSessionPersistence: { storage: 'sessionStorage', type: 'SESSION' },
  browserPopupRedirectResolver: { resolver: 'browser-popup' },
  signInWithPopup: jest.fn(),
  signInWithCustomToken: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signOut: jest.fn(async () => undefined),
  onIdTokenChanged: jest.fn(),
}));
jest.mock('@/lib/firebaseApp', () => ({ app: { name: 'web-app' } }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => false,
  requestAndroidHost: jest.fn(),
}));

import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { requestAndroidHost } from '@/platform/android-host/androidHostBridge';
import { logOut, onAuthChange, signInWithGoogleSession } from '@/lib/authService';

describe('Browser and iPhone PWA auth bootstrap contract', () => {
  it('기존 브라우저 저장 우선순위를 유지하고 재방문 초기화에 팝업 resolver를 넣지 않는다', () => {
    expect(initializeAuth).toHaveBeenCalledTimes(1);
    expect(initializeAuth).toHaveBeenCalledWith({ name: 'web-app' }, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
    expect(getAuth).not.toHaveBeenCalled();
    expect(signInWithPopup).not.toHaveBeenCalled();
    expect(requestAndroidHost).not.toHaveBeenCalled();
  });

  it('SDK가 복원한 사용자와 같은 UID의 토큰 변경을 기존 observer로 전달한다', () => {
    const callback = jest.fn();
    const unsubscribe = jest.fn();
    jest.mocked(onIdTokenChanged).mockReturnValueOnce(unsubscribe);

    expect(onAuthChange(callback)).toBe(unsubscribe);
    expect(onIdTokenChanged).toHaveBeenCalledWith(
      { runtime: 'browser-auth', currentUser: null }, callback
    );
    // SDK callback을 그대로 사용하므로 앱이 저장된 사용자를 자체 확정하지 않습니다.
    const restored = { uid: 'restored-user' };
    const observer = jest.mocked(onIdTokenChanged).mock.calls[0][1] as typeof callback;
    observer(restored);
    observer({ ...restored });
    observer(null);
    expect(callback.mock.calls).toEqual([[restored], [restored], [null]]);
  });

  it('실제 Google 로그인에서 resolver를 명시하고 성공한 Firebase 사용자만 반환한다', async () => {
    const user = { uid: 'signed-in-user' };
    jest.mocked(signInWithPopup).mockResolvedValueOnce({ user } as never);

    await expect(signInWithGoogleSession()).resolves.toEqual({ user });
    expect(signInWithPopup).toHaveBeenLastCalledWith(
      { runtime: 'browser-auth', currentUser: null },
      expect.any(Object),
      browserPopupRedirectResolver
    );
    expect(requestAndroidHost).not.toHaveBeenCalled();
  });

  it.each(['auth/popup-closed-by-user', 'auth/popup-blocked'])(
    '%s는 기존 null 결과를 유지하며 다음 로그인 시 다시 팝업을 사용할 수 있다', async code => {
      jest.mocked(signInWithPopup).mockRejectedValueOnce({ code });
      await expect(signInWithGoogleSession()).resolves.toBeNull();
      const user = { uid: 'retried-user' };
      jest.mocked(signInWithPopup).mockResolvedValueOnce({ user } as never);
      await expect(signInWithGoogleSession()).resolves.toEqual({ user });
      expect(signInWithPopup).toHaveBeenLastCalledWith(
        { runtime: 'browser-auth', currentUser: null }, expect.any(Object), browserPopupRedirectResolver
      );
    }
  );

  it('브라우저 로그아웃은 같은 영속 Auth를 비우고 Native 세션을 호출하지 않는다', async () => {
    await logOut();
    expect(signOut).toHaveBeenCalledWith({ runtime: 'browser-auth', currentUser: null });
    expect(requestAndroidHost).not.toHaveBeenCalled();
  });
});
