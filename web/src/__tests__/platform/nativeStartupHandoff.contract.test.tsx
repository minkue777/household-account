import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import AppLoadingScreen from '@/components/AppLoadingScreen';
import HouseholdGuard from '@/components/HouseholdGuard';
import GuestPage from '@/app/guest/page';
import { StartupDisplayProvider } from '@/contexts/StartupDisplayContext';
import { NativeStartupHandoff } from '@/platform/android-host/NativeStartupHandoff';

let mockLoginReady = false;
let mockPathname = '/';
let mockAuthenticated = false;
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => mockRouter,
}));
jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: () => ({
    household: null,
    sessionState: 'signed-out',
    isLoading: false,
    isAuthenticated: mockAuthenticated,
    sessionError: null,
  }),
}));
jest.mock('next/dynamic', () => (
  _load: unknown,
  { loading: Loading }: { loading: React.ComponentType }
) => function DeferredLogin() {
  return mockLoginReady ? <main>로그인</main> : <Loading />;
});

describe('Native 시작 화면에서 준비된 실제 Web 화면으로 전환', () => {
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    mockLoginReady = false;
    mockPathname = '/';
    window.history.replaceState({}, '', '/');
    mockAuthenticated = false;
    mockReplace.mockClear();
    window.__HOUSEHOLD_NATIVE_STARTUP__ = true;
    postMessage = jest.fn(message => {
      const request = JSON.parse(message);
      window.HouseholdNativeBridge?.onmessage?.({
        data: JSON.stringify({
          contractVersion: 'android-bridge-response.v1',
          requestId: request.requestId,
          result: { kind: 'succeeded', value: {} },
        }),
      });
    });
    window.HouseholdNativeBridge = { postMessage, onmessage: null };
  });

  afterEach(() => {
    cleanup();
    delete window.__HOUSEHOLD_NATIVE_STARTUP__;
    delete window.HouseholdNativeBridge;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function nextFrame() {
    act(() => jest.advanceTimersByTime(16));
  }

  it.each(['홈', '로그인', '가입', '오류'])('최초 commit이 %s 실제 화면이면 다음 frame에 한 번 보낸다', content => {
    const view = render(<NativeStartupHandoff><main>{content}</main></NativeStartupHandoff>);
    expect(postMessage).not.toHaveBeenCalled();
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
      contractVersion: 'android-bridge.v1', operation: 'startup.content-ready', payload: {},
    });
    view.rerender(<NativeStartupHandoff><AppLoadingScreen /></NativeStartupHandoff>);
    view.rerender(<NativeStartupHandoff><main>{content}</main></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('인증 로딩에서 원장 로딩으로 교체되는 동안 보내지 않고 전체 준비 뒤에 보낸다', () => {
    const view = render(<NativeStartupHandoff><AppLoadingScreen key="auth" /></NativeStartupHandoff>);
    expect(screen.getByRole('status')).toHaveAttribute('data-startup-screen');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    nextFrame();
    view.rerender(<NativeStartupHandoff><AppLoadingScreen key="ledger" /></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).not.toHaveBeenCalled();
    view.rerender(<NativeStartupHandoff><main>준비된 홈</main></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('frame 전에 새 로딩이 생기면 이전 로딩 cleanup으로 시작 화면을 내리지 않는다', () => {
    const view = render(<NativeStartupHandoff><AppLoadingScreen /></NativeStartupHandoff>);
    nextFrame();
    view.rerender(<NativeStartupHandoff><main>이전 화면</main></NativeStartupHandoff>);
    view.rerender(<NativeStartupHandoff><AppLoadingScreen /></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('동적 로그인 청크가 준비될 때까지 기존 시작 화면 marker를 유지한다', () => {
    const tree = () => <StartupDisplayProvider><NativeStartupHandoff>
      <HouseholdGuard><main>홈</main></HouseholdGuard>
    </NativeStartupHandoff></StartupDisplayProvider>;
    const view = render(tree());
    act(() => jest.advanceTimersByTime(2_016));
    expect(screen.getByRole('status')).toHaveAttribute('data-startup-screen');
    expect(postMessage).not.toHaveBeenCalled();
    mockLoginReady = true;
    view.rerender(tree());
    expect(screen.getByRole('main')).toHaveTextContent('로그인');
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['/', '/admin'])('%s의 실제 Suspense가 해소되기 전에는 시작 화면을 유지한다', async pathname => {
    mockPathname = pathname;
    window.history.replaceState({}, '', pathname);
    mockAuthenticated = true;
    let ready = false;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    function DeferredPage() {
      if (!ready) throw pending;
      return <main>준비된 페이지</main>;
    }
    render(<NativeStartupHandoff><HouseholdGuard><DeferredPage /></HouseholdGuard></NativeStartupHandoff>);
    nextFrame();
    expect(screen.getByRole('status')).toHaveAttribute('data-startup-screen');
    expect(screen.getByRole('status')).toHaveAttribute('data-startup-mode', pathname === '/admin' ? 'admin' : 'brand');
    expect(postMessage).not.toHaveBeenCalled();

    await act(async () => { ready = true; finish(); await pending; });
    expect(screen.getByRole('main')).toHaveTextContent('준비된 페이지');
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('게스트 경로에서 홈으로 이동하는 동안 빈 DOM을 준비된 화면으로 보내지 않는다', () => {
    mockPathname = '/guest';
    mockAuthenticated = true;
    const view = render(<NativeStartupHandoff><HouseholdGuard><GuestPage /></HouseholdGuard></NativeStartupHandoff>);
    expect(mockReplace).toHaveBeenCalledWith('/');
    nextFrame();
    expect(screen.getByRole('status')).toHaveAttribute('data-startup-screen');
    expect(postMessage).not.toHaveBeenCalled();

    mockPathname = '/';
    view.rerender(<NativeStartupHandoff><HouseholdGuard><main>준비된 홈</main></HouseholdGuard></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false])('지원 flag=%s인 PWA·구버전 APK에는 보내지 않는다', flag => {
    window.__HOUSEHOLD_NATIVE_STARTUP__ = flag;
    const view = render(<NativeStartupHandoff><AppLoadingScreen /></NativeStartupHandoff>);
    nextFrame();
    view.rerender(<NativeStartupHandoff><main>홈</main></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('Native bridge가 없으면 지원 flag만으로 요청하지 않는다', () => {
    delete window.HouseholdNativeBridge;
    render(<NativeStartupHandoff><main>홈</main></NativeStartupHandoff>);
    nextFrame();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('StrictMode effect 재시작과 로딩 cleanup은 한 번의 전환으로 수렴한다', () => {
    const view = render(<StrictMode><NativeStartupHandoff><AppLoadingScreen /></NativeStartupHandoff></StrictMode>);
    nextFrame();
    expect(postMessage).not.toHaveBeenCalled();
    view.rerender(<StrictMode><NativeStartupHandoff><main>홈</main></NativeStartupHandoff></StrictMode>);
    nextFrame();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('루트가 제거되면 취소된 frame이 늦게 실행되어도 보내지 않는다', () => {
    let pending: FrameRequestCallback | undefined;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { pending = callback; return 1; });
    const cancel = jest.spyOn(window, 'cancelAnimationFrame');
    const view = render(<NativeStartupHandoff><AppLoadingScreen /></NativeStartupHandoff>);
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(1);
    act(() => pending?.(16));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
