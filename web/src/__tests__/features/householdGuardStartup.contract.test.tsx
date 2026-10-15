import { act, render, screen } from '@testing-library/react';
import HouseholdGuard from '@/components/HouseholdGuard';
import { StartupDisplayProvider } from '@/contexts/StartupDisplayContext';
import { clearSignedInMembershipCache, writeSignedInMembershipCache } from '@/features/access-household/application/signedInMembershipCache';
import { selectAdminHouseholdView } from '@/features/access-household/application/adminHouseholdViewSelection';

let mockPathname = '/assets';
let mockSession = {
  household: null as { name: string } | null,
  isLoading: false,
  isAuthenticated: true,
  sessionError: null as string | null,
  sessionState: 'ready',
};

jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => mockSession }));
jest.mock('next/dynamic', () => () => function Login() {
  return <div data-testid="household-login">로그인 안내</div>;
});

function guardedPage() {
  return <StartupDisplayProvider><HouseholdGuard><div data-testid="page-content" /></HouseholdGuard></StartupDisplayProvider>;
}

describe('[T-LED-001] 문서 최초 시작 화면의 경로·인증 경계', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPathname = '/assets';
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockSession = { household: null, isLoading: false, isAuthenticated: true, sessionError: null, sessionState: 'ready' };
  });
  afterEach(() => jest.useRealTimers());

  function rememberHousehold(name: string, householdId = 'household-1') {
    writeSignedInMembershipCache('uid-1', {
      kind: 'membership-found',
      membership: { householdId, memberId: 'member-1', displayName: '사용자', aggregateVersion: 1, status: 'active', capabilities: [] },
      household: { id: householdId, name, createdAt: '2026-10-15T00:00:00.000Z', members: [] },
    });
  }

  it('인증 전에는 저장된 이름을 표시하되 페이지는 열지 않고, 갱신·삭제를 즉시 반영한다', () => {
    rememberHousehold('또니망고네');
    mockSession = { household: null, isLoading: true, isAuthenticated: false, sessionError: null, sessionState: 'resolving' };
    render(guardedPage());
    expect(screen.getByRole('heading', { name: '또니망고네' })).toBeVisible();
    act(() => jest.advanceTimersByTime(2_500));
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('household-login')).not.toBeInTheDocument();
    act(() => rememberHousehold('익태송희네', 'household-2'));
    expect(screen.getByRole('heading', { name: '익태송희네' })).toBeVisible();
    expect(screen.queryByText('또니망고네')).not.toBeInTheDocument();
    act(() => clearSignedInMembershipCache());
    expect(screen.getByRole('heading')).toBeEmptyDOMElement();
  });

  it('서버에서 확인한 이름을 우선하고 로그아웃·첫 방문에는 저장된 이름을 표시하지 않는다', () => {
    rememberHousehold('이전 가구네');
    mockSession.household = { name: '새 가구네' };
    const view = render(guardedPage());
    expect(screen.getByRole('heading', { name: '새 가구네' })).toBeVisible();
    for (const sessionState of ['signed-out', 'first-visit', 'legacy-confirmation']) {
      mockSession = { household: null, isLoading: false, isAuthenticated: false, sessionError: null, sessionState };
      view.rerender(guardedPage());
      expect(screen.getByRole('heading')).toBeEmptyDOMElement();
    }
  });

  it('관리자 다른 가구 조회 중에는 본인 가구의 저장된 이름을 사용하지 않는다', () => {
    rememberHousehold('본인 가구네');
    selectAdminHouseholdView({ householdId: 'household-2', householdName: '조회 가구네' });
    mockSession = { household: null, isLoading: true, isAuthenticated: false, sessionError: null, sessionState: 'resolving' };
    render(guardedPage());
    expect(screen.getByRole('heading')).toBeEmptyDOMElement();
  });

  it('기기 저장소 접근이 거부되어도 이름만 생략하고 시작 화면을 유지한다', () => {
    mockSession = { household: null, isLoading: true, isAuthenticated: false, sessionError: null, sessionState: 'resolving' };
    const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    try {
      render(guardedPage());
      expect(screen.getByRole('heading')).toBeEmptyDOMElement();
      expect(screen.getByRole('status')).toHaveTextContent('로딩중...');
    } finally {
      read.mockRestore();
    }
  });

  it.each(['/assets', '/settings', '/stats'])('인증된 %s 직접 진입은 최초 2초 후 페이지를 표시한다', pathname => {
    mockPathname = pathname;
    const view = render(guardedPage());
    expect(screen.getByRole('status')).toHaveTextContent('로딩중...');
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1_999));
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId('page-content')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    mockPathname = '/settings';
    view.rerender(guardedPage());
    expect(screen.getByTestId('page-content')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['/', '/income'])('%s는 최소시간 전에 페이지를 mount하여 홈 조회를 시작한다', pathname => {
    mockPathname = pathname;
    render(guardedPage());
    expect(screen.getByTestId('page-content')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('비인증 상태는 최소시간 후 로그인 화면을 표시한다', () => {
    mockSession.isAuthenticated = false;
    render(guardedPage());
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByTestId('household-login')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(2_000));
    expect(screen.getByTestId('household-login')).toBeVisible();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it('현재 가구명을 실제 글자로 표시하고 가구 전환·해제 시 이전 이름을 남기지 않는다', () => {
    const view = render(guardedPage());
    expect(screen.getByRole('heading')).toBeEmptyDOMElement();
    expect(screen.getByText('가계부 · 자산')).toBeVisible();

    for (const name of ['또니망고네', '익태송희네', '함께 쓰는 가계부']) {
      mockSession.household = { name };
      view.rerender(guardedPage());
      expect(screen.getByRole('heading', { name })).toHaveTextContent(name);
      expect(screen.getByRole('status')).toHaveTextContent('가계부 · 자산');
    }

    mockSession.household = null;
    mockSession.isAuthenticated = false;
    view.rerender(guardedPage());
    expect(screen.getByRole('heading')).toBeEmptyDOMElement();
    expect(screen.queryByText('함께 쓰는 가계부')).not.toBeInTheDocument();
    expect(screen.queryByTestId('household-login')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(2_000));
    expect(screen.getByTestId('household-login')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('인증 실패는 최소시간을 기다리지 않고 로그인 복구 화면을 표시한다', () => {
    mockSession = { household: null, isLoading: false, isAuthenticated: false, sessionError: 'offline', sessionState: 'error' };
    render(guardedPage());
    expect(screen.getByTestId('household-login')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it.each(['/admin', '/admin/households'])('%s는 인증·최소시간 대기를 우회한다', pathname => {
    mockPathname = pathname;
    mockSession = { household: null, isLoading: true, isAuthenticated: false, sessionError: null, sessionState: 'resolving' };
    render(guardedPage());
    expect(screen.getByTestId('page-content')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('household-login')).not.toBeInTheDocument();
  });
});
