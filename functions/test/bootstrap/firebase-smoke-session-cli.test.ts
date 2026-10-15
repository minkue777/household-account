import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(__dirname, '../../..');
const script = join(root, 'functions/scripts/prepare-smoke-session.cjs');

interface SmokeUser {
  uid: string;
  getIdToken(forceRefresh: boolean): Promise<string>;
}

function smokeLoginPage(popupUser: SmokeUser) {
  const source = readFileSync(script, 'utf8');
  const pageExpression = source.slice(source.indexOf('  const page = '), source.indexOf('  const server = '));
  const page: string = runInNewContext(`${pageExpression}\npage;`, { sdkVersion: 'test', config: {}, nonce: 'test-nonce' });
  const browserScript = page.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!.replace(/^\s*import .*?;$/gm, '');
  const login: { disabled: boolean; onclick?: () => Promise<void> } = { disabled: true };
  const logout = { hidden: true };
  const status = { textContent: '' };
  let authListener: (user: SmokeUser | null) => void;
  const fetchSession = vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'ready' }) }));
  runInNewContext(browserScript, {
    initializeApp: () => ({}), initializeAuth: () => ({}), browserLocalPersistence: {}, browserPopupRedirectResolver: {},
    GoogleAuthProvider: class {}, signInWithPopup: async () => ({ user: popupUser }), signOut: vi.fn(),
    onAuthStateChanged: (_auth: unknown, listener: typeof authListener) => { authListener = listener; },
    document: { getElementById: (id: string) => ({ login, logout, status })[id as 'login' | 'logout' | 'status'] },
    fetch: fetchSession, AbortSignal,
  });
  return { login, status, fetchSession, notifyAuth: (user: SmokeUser | null) => authListener(user) };
}

describe('[REL-001] 실제 배포 로그인 준비 CLI의 자격 저장 경계', () => {
  it.each(['.smoke.id-token', '..smoke.id-token'])(
    '저장소 안의 %s 경로는 인증 전에 거부한다', tokenName => {
      const result = spawnSync(process.execPath, [script, '--token-file', join(root, tokenName)], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({ code: 'SMOKE_TOKEN_MUST_BE_OUTSIDE_REPOSITORY' });
    });

  it('출력 파일을 지정하지 않으면 로그인 서버를 열지 않는다', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ code: 'SMOKE_TOKEN_FILE_REQUIRED' });
  });

  it('에뮬레이터 인증을 운영 배포 인증으로 준비하지 않는다', () => {
    const result = spawnSync(process.execPath, [script, '--token-file', join(tmpdir(), 'smoke-cli-test.id-token')], {
      encoding: 'utf8', env: { ...process.env, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ code: 'PRODUCTION_EMULATOR_MIXED' });
  });

  it('저장 로그인 갱신 실패 후 같은 계정의 팝업 결과를 직접 제출한다', async () => {
    const recovered = { uid: 'same-user', getIdToken: vi.fn().mockResolvedValue('test-token') };
    const page = smokeLoginPage(recovered);
    page.notifyAuth({ uid: recovered.uid, getIdToken: vi.fn().mockRejectedValue({ code: 'auth/network-request-failed' }) });
    await vi.waitFor(() => expect(page.login.disabled).toBe(false));

    // Firebase는 같은 UID로 다시 로그인하면 onAuthStateChanged를 다시 호출하지 않는다.
    await page.login.onclick!();

    expect(recovered.getIdToken).toHaveBeenCalledWith(true);
    expect(page.fetchSession).toHaveBeenCalledExactlyOnceWith('/session', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json', 'x-release-nonce': 'test-nonce' },
      body: JSON.stringify({ token: 'test-token' }),
    }));
    expect(page.status.textContent).toContain('확인 완료했습니다.');
  });

  it('최초 로그인 이벤트와 팝업 결과가 겹쳐도 토큰 갱신과 제출은 한 번만 한다', async () => {
    let completeToken!: (token: string) => void;
    const user = { uid: 'first-user', getIdToken: vi.fn(() => new Promise<string>(resolve => { completeToken = resolve; })) };
    const page = smokeLoginPage(user);
    page.notifyAuth(user);
    const popup = page.login.onclick!();
    await Promise.resolve();
    completeToken('test-token');
    await popup;

    expect(user.getIdToken).toHaveBeenCalledTimes(1);
    expect(page.fetchSession).toHaveBeenCalledTimes(1);
    expect(page.status.textContent).toContain('확인 완료했습니다.');
  });
});
