jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
}));

jest.mock('@/platform/security/firebaseAppCheck', () => ({
  initializeFirebaseAppCheck: jest.fn(),
}));

jest.mock('@/lib/authService', () => ({
  getCurrentUser: jest.fn(),
  refreshAndroidWebAuth: jest.fn(),
  restoreAndroidHostAuth: jest.fn(),
}));

import {
  getCurrentUser,
  refreshAndroidWebAuth,
  restoreAndroidHostAuth,
} from '@/lib/authService';
import {
  REMOTE_SESSION_RECOVERED_EVENT,
  withFirebaseCallableRecovery,
} from '@/platform/functions-api/firebaseCallableRecovery';

const mockGetCurrentUser = jest.mocked(getCurrentUser);
const mockRefreshAndroidWebAuth = jest.mocked(refreshAndroidWebAuth);
const mockRestoreAndroidHostAuth = jest.mocked(restoreAndroidHostAuth);

describe('Android Firebase callable 인증 복구 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unauthenticated이면 Native 세션을 복구하고 같은 요청을 한 번 재시도한다', async () => {
    const user = { uid: 'uid-1' };
    mockGetCurrentUser.mockReturnValue(user as never);
    mockRefreshAndroidWebAuth.mockResolvedValue({ user } as never);
    const operation = jest.fn()
      .mockRejectedValueOnce({ code: 'functions/unauthenticated' })
      .mockResolvedValueOnce('accepted');
    const recovered = jest.fn();
    window.addEventListener(REMOTE_SESSION_RECOVERED_EVENT, recovered);

    await expect(withFirebaseCallableRecovery(operation)).resolves.toBe('accepted');

    expect(operation).toHaveBeenCalledTimes(2);
    expect(mockRefreshAndroidWebAuth).toHaveBeenCalledWith(user);
    expect(mockRestoreAndroidHostAuth).not.toHaveBeenCalled();
    expect(recovered).toHaveBeenCalledTimes(1);
    window.removeEventListener(REMOTE_SESSION_RECOVERED_EVENT, recovered);
  });

  it('업무 permission-denied는 인증 문제로 오인해 재시도하지 않는다', async () => {
    const failure = { code: 'functions/permission-denied' };
    const operation = jest.fn().mockRejectedValue(failure);

    await expect(withFirebaseCallableRecovery(operation)).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(mockRefreshAndroidWebAuth).not.toHaveBeenCalled();
    expect(mockRestoreAndroidHostAuth).not.toHaveBeenCalled();
  });
});
