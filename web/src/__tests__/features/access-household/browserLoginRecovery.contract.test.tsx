import { act, fireEvent, render, screen } from '@testing-library/react';
import type { User, UserCredential } from 'firebase/auth';

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(),
  initializeAuth: jest.fn(() => ({ currentUser: null })),
  indexedDBLocalPersistence: { type: 'LOCAL' },
  browserLocalPersistence: { type: 'LOCAL' },
  browserSessionPersistence: { type: 'SESSION' },
  browserPopupRedirectResolver: {},
  GoogleAuthProvider: jest.fn(),
  signInWithPopup: jest.fn(),
  onIdTokenChanged: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock('@/lib/firebaseApp', () => ({ app: { name: 'browser-login-test' } }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => false,
  requestAndroidHost: jest.fn(),
}));
jest.mock('@/features/access-household/application/householdCommands', () => ({
  householdCommands: { resolveSignedInUser: jest.fn() },
}));

import { onIdTokenChanged, signInWithPopup } from 'firebase/auth';
import HouseholdLogin from '@/components/HouseholdLogin';
import { HouseholdProvider } from '@/contexts/HouseholdContext';
import { householdCommands } from '@/features/access-household/application/householdCommands';

let observeAuth: (user: User | null) => void;

function pendingPopup() {
  let resolve!: (result: UserCredential) => void;
  const promise = new Promise<UserCredential>(done => { resolve = done; });
  jest.mocked(signInWithPopup).mockReturnValueOnce(promise);
  return resolve;
}

async function renderSignedOut() {
  await act(async () => {
    render(<HouseholdProvider><HouseholdLogin /></HouseholdProvider>);
  });
  expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeEnabled();
  expect(householdCommands.resolveSignedInUser).not.toHaveBeenCalled();
}

async function startLogin() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Google로 로그인' }));
  });
  expect(screen.getByRole('button', { name: '로그인 중...' })).toBeDisabled();
}

describe('브라우저 Google 로그인 대기 복구 계약', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    jest.mocked(onIdTokenChanged).mockImplementation((_auth, callback) => {
      observeAuth = callback as (user: User | null) => void;
      observeAuth(null);
      return jest.fn();
    });
    jest.mocked(householdCommands.resolveSignedInUser).mockResolvedValue({
      kind: 'first-visit-required', choices: ['create', 'join'],
    });
  });

  afterEach(() => { jest.useRealTimers(); });

  it('SDK 팝업 무응답은 오류와 재시도 버튼으로 끝나고 다음 로그인은 실제 Provider를 통해 복원한다', async () => {
    pendingPopup();
    await renderSignedOut();
    await startLogin();
    await act(async () => { await jest.advanceTimersByTimeAsync(179_999); });
    expect(screen.getByRole('button', { name: '로그인 중...' })).toBeDisabled();
    expect(householdCommands.resolveSignedInUser).not.toHaveBeenCalled();

    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(screen.getByText('Google 로그인을 완료하지 못했습니다.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeEnabled();

    const user = { uid: 'retried-user' } as User;
    jest.mocked(signInWithPopup).mockResolvedValueOnce({ user } as UserCredential);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Google로 로그인' }));
    });
    expect(signInWithPopup).toHaveBeenCalledTimes(2);
    expect(householdCommands.resolveSignedInUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '새 가계부 만들기' })).toBeEnabled();
    expect(screen.queryByText('Google 로그인을 완료하지 못했습니다.')).not.toBeInTheDocument();
  });

  it('대기 종료 후 늦은 유효 SDK 인증 알림도 서버 확인 뒤 첫 방문 화면으로 복원한다', async () => {
    const resolvePopup = pendingPopup();
    await renderSignedOut();
    await startLogin();
    await act(async () => { await jest.advanceTimersByTimeAsync(180_000); });
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeEnabled();

    const user = { uid: 'late-user' } as User;
    await act(async () => { observeAuth(user); });
    expect(householdCommands.resolveSignedInUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '새 가계부 만들기' })).toBeEnabled();
    expect(screen.queryByText('Google 로그인을 완료하지 못했습니다.')).not.toBeInTheDocument();

    await act(async () => { resolvePopup({ user } as UserCredential); });
    expect(householdCommands.resolveSignedInUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '새 가계부 만들기' })).toBeEnabled();
  });

  it('SDK 인증 알림이 먼저 복원한 세션을 뒤늦은 팝업 시간 초과가 로그아웃 화면으로 되돌리지 않는다', async () => {
    pendingPopup();
    await renderSignedOut();
    await startLogin();
    await act(async () => { observeAuth({ uid: 'observer-first-user' } as User); });
    expect(screen.getByRole('button', { name: '새 가계부 만들기' })).toBeEnabled();

    await act(async () => { await jest.advanceTimersByTimeAsync(180_000); });
    expect(screen.getByRole('button', { name: '새 가계부 만들기' })).toBeEnabled();
    expect(screen.queryByText('Google 로그인을 완료하지 못했습니다.')).not.toBeInTheDocument();
    expect(householdCommands.resolveSignedInUser).toHaveBeenCalledTimes(1);
  });
});
