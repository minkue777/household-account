jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ runtime: 'default-auth' })),
  initializeAuth: jest.fn(() => ({ runtime: 'android-memory-auth' })),
  inMemoryPersistence: { type: 'NONE' },
  signInWithPopup: jest.fn(),
  signInWithCustomToken: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));
jest.mock('@/lib/firebase', () => ({ app: { name: 'web-app' } }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
  requestAndroidHost: jest.fn(),
}));

import {
  getAuth,
  initializeAuth,
  signInWithCustomToken,
} from 'firebase/auth';
import { requestAndroidHost } from '@/platform/android-host/androidHostBridge';
import { restoreAndroidHostAuth } from '@/lib/authService';

describe('Android WebView auth bootstrap contract', () => {
  it('native 세션을 custom token으로 교환하고 WebView에는 메모리 persistence를 사용한다', async () => {
    const user = { uid: 'uid-1' };
    jest.mocked(requestAndroidHost).mockResolvedValue({ customToken: 'custom-token' });
    jest.mocked(signInWithCustomToken).mockResolvedValue({ user } as never);

    await expect(restoreAndroidHostAuth()).resolves.toBe(user);

    expect(initializeAuth).toHaveBeenCalledWith(
      { name: 'web-app' },
      { persistence: { type: 'NONE' } }
    );
    expect(getAuth).not.toHaveBeenCalled();
    expect(requestAndroidHost).toHaveBeenCalledWith('auth.sign-in', {});
    expect(signInWithCustomToken).toHaveBeenCalledWith(
      { runtime: 'android-memory-auth' },
      'custom-token'
    );
  });
});
