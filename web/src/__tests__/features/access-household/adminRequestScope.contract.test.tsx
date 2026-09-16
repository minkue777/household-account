import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminPage from '@/app/admin/page';
import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

const mockDashboard = jest.fn();
const mockMembers = jest.fn();
const mockProfiles = jest.fn();
const mockAssets = jest.fn();
const mockRemove = jest.fn();
const mockPrompt = jest.fn();
let mockAuthChanged: (user: { uid: string; email: string } | null) => void;
jest.mock('@/features/access-household/application/adminHouseholds', () => ({
  adminHouseholds: {
    dashboard: (...args: unknown[]) => mockDashboard(...args),
    listMembers: (...args: unknown[]) => mockMembers(...args),
    listDeletedAssets: (...args: unknown[]) => mockAssets(...args),
    removeMember: (...args: unknown[]) => mockRemove(...args),
  },
}));
jest.mock('@/features/access-household/application/assetOwnerProfiles', () => ({
  assetOwnerProfiles: { list: (...args: unknown[]) => mockProfiles(...args) },
}));
jest.mock('@/lib/authService', () => ({
  onAuthChange: (callback: typeof mockAuthChanged) => {
    mockAuthChanged = callback;
    callback({ uid: 'admin', email: 'admin@example.test' });
    return () => {};
  },
  logOut: jest.fn(), signInWithGoogle: jest.fn(),
}));
jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: () => ({ showConfirm: jest.fn(), showPrompt: mockPrompt }),
}));
jest.mock('@/platform/functions-api', () => ({ AdminAccessError: class extends Error {} }));
jest.mock('@/components/admin/AdminOperationsOverview', () => ({
  AdminOperationsOverview: ({ dashboard }: { dashboard: AdminOperationsDashboardWireView }) => (
    <div>대시보드 {dashboard.service.revision}</div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function dashboard(revision = 'current'): AdminOperationsDashboardWireView {
  return {
    generatedAt: '2026-09-17T00:00:00Z',
    service: { apiStatus: 'online', health: 'healthy', serviceName: 'admin', revision, region: 'asia-northeast3' },
    summary: { activeHouseholds: 2, deletedHouseholds: 0, activeMembers: 0, todayAccessCount: 0, totalAccessCount: 0, unhealthyProviders: 0, openIncidents: 0 },
    households: ['A', 'B'].map(id => ({
      householdId: id, name: `${id} 가구`, createdAt: '2026-09-17T00:00:00Z',
      lifecycleState: 'active', aggregateVersion: 1, memberCount: 0,
      totalAccessCount: 0, todayAccessCount: 0, members: [],
    })),
    dailyAccess: [], scheduledJobs: [], providerHealth: [], incidents: [],
    functionLatency: { status: 'available', windowHours: 24, operations: [] },
    billingCost: { status: 'unavailable' },
  };
}

function detailRequest(label: string) {
  const members = deferred<{ members: unknown[] }>();
  const profiles = deferred<{ profiles: unknown[] }>();
  const assets = deferred<{ assets: unknown[] }>();
  mockMembers.mockImplementationOnce(() => members.promise);
  mockProfiles.mockImplementationOnce(() => profiles.promise);
  mockAssets.mockImplementationOnce(() => assets.promise);
  return {
    resolve: () => {
      members.resolve({ members: [{ memberId: `${label}-member`, displayName: `${label} 가구원`, lifecycleState: 'active', aggregateVersion: 1, linkedPrincipal: true }] });
      profiles.resolve({ profiles: [{ profileId: `${label}-profile`, householdId: label, displayName: `${label} 명의자`, profileType: 'dependent', lifecycleState: 'active', aggregateVersion: 1 }] });
      assets.resolve({ assets: [{ assetId: `${label}-asset`, name: `${label} 자산`, lifecycleState: 'deleted', aggregateVersion: 1 }] });
    },
    reject: () => members.reject(new Error('late read failed')),
  };
}

function openDetails(id: 'A' | 'B') {
  const row = screen.getByText(`${id} 가구`).closest('article');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole('button', { name: '관리', exact: true }));
}

describe('관리자 페이지의 인증·상세 요청 범위', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDashboard.mockReset().mockResolvedValue(dashboard());
    mockMembers.mockReset(); mockProfiles.mockReset(); mockAssets.mockReset();
    mockRemove.mockReset().mockResolvedValue({ kind: 'success' });
    mockPrompt.mockReset().mockResolvedValue('관리 사유');
  });

  it('A→B→A 선택 후 응답 순서가 역전되어도 마지막 A의 세 가지 상세만 표시한다', async () => {
    const oldA = detailRequest('old A');
    const oldB = detailRequest('old B');
    const latestA = detailRequest('latest A');
    render(<AdminPage />);
    await screen.findByText('A 가구');
    openDetails('A'); openDetails('B'); openDetails('A');
    await act(async () => latestA.resolve());
    await act(async () => { oldB.resolve(); oldA.resolve(); });
    expect(screen.getByText('latest A 가구원 · 활성')).toBeInTheDocument();
    expect(screen.getByText('latest A 명의자 · 활성')).toBeInTheDocument();
    expect(screen.getByText('latest A 자산 · v1')).toBeInTheDocument();
    expect(screen.queryByText(/old [AB] (가구원|명의자|자산)/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '제거', exact: true }));
    await act(async () => {});
    expect(mockRemove).toHaveBeenCalledWith('A', 'latest A-member', 1, '관리 사유');
  });

  it('이전 조회 실패는 현재 가구의 loading과 오류를 변경하지 않는다', async () => {
    const old = detailRequest('old A');
    const current = detailRequest('current B');
    render(<AdminPage />);
    await screen.findByText('A 가구');
    openDetails('A'); openDetails('B');
    await act(async () => old.reject());
    expect(screen.getByText('운영 정보를 불러오는 중입니다.')).toBeInTheDocument();
    expect(screen.queryByText('가구 운영 정보를 불러오지 못했습니다.')).not.toBeInTheDocument();
    await act(async () => current.resolve());
    expect(screen.getByText('current B 가구원 · 활성')).toBeInTheDocument();
  });

  it.each(['success', 'failure'])('닫은 상세의 늦은 %s 응답은 다시 연 조회를 덮지 않는다', async result => {
    const closed = detailRequest('closed A');
    const reopened = detailRequest('reopened A');
    render(<AdminPage />);
    await screen.findByText('A 가구');
    openDetails('A');
    fireEvent.click(screen.getByRole('button', { name: '닫기', exact: true }));
    expect(screen.queryByText('관리자 작업')).not.toBeInTheDocument();
    openDetails('A');
    await act(async () => result === 'success' ? closed.resolve() : closed.reject());
    expect(screen.getByText('운영 정보를 불러오는 중입니다.')).toBeInTheDocument();
    expect(screen.queryByText('가구 운영 정보를 불러오지 못했습니다.')).not.toBeInTheDocument();
    await act(async () => reopened.resolve());
    expect(screen.getByText('reopened A 가구원 · 활성')).toBeInTheDocument();
  });

  it('로그아웃·재로그인 후에는 이전 dashboard와 상세 응답이 현재 인증 결과에 적용되지 않는다', async () => {
    const oldDetails = detailRequest('old A');
    const oldDashboard = deferred<AdminOperationsDashboardWireView>();
    const newDashboard = deferred<AdminOperationsDashboardWireView>();
    render(<AdminPage />);
    await screen.findByText('A 가구');
    openDetails('A');
    mockDashboard.mockImplementationOnce(() => oldDashboard.promise).mockImplementationOnce(() => newDashboard.promise);
    fireEvent.focus(window);
    await act(async () => mockAuthChanged(null));
    expect(screen.getByText('관리자 로그인')).toBeInTheDocument();
    await act(async () => mockAuthChanged({ uid: 'other-admin', email: 'other@example.test' }));
    expect(mockDashboard).toHaveBeenCalledTimes(3);
    await act(async () => { oldDashboard.resolve(dashboard('old')); oldDetails.reject(); });
    expect(screen.queryByText('대시보드 old')).not.toBeInTheDocument();
    expect(screen.queryByText('가구 운영 정보를 불러오지 못했습니다.')).not.toBeInTheDocument();
    await act(async () => newDashboard.resolve(dashboard('new')));
    expect(screen.getByText('대시보드 new')).toBeInTheDocument();
    expect(screen.queryByText('관리자 작업')).not.toBeInTheDocument();
  });

  it('이전 가구 관리 명령의 늦은 완료는 새 상세를 다시 열거나 조회하지 않는다', async () => {
    const a = detailRequest('A');
    const b = detailRequest('B');
    const removal = deferred<unknown>();
    mockRemove.mockImplementationOnce(() => removal.promise);
    render(<AdminPage />);
    await screen.findByText('A 가구');
    openDetails('A');
    await act(async () => a.resolve());
    fireEvent.click(screen.getByRole('button', { name: '제거', exact: true }));
    await act(async () => {});
    openDetails('B');
    await act(async () => b.resolve());
    await act(async () => removal.resolve({ kind: 'success' }));
    expect(screen.getByText('B 가구원 · 활성')).toBeInTheDocument();
    expect(mockMembers.mock.calls).toEqual([['A'], ['B']]);
    expect(mockDashboard).toHaveBeenCalledTimes(1);
  });

  it('확인 대화상자 대기 중 상세를 닫으면 이전 가구의 명령을 보내지 않는다', async () => {
    const a = detailRequest('A');
    const prompt = deferred<string>();
    mockPrompt.mockImplementationOnce(() => prompt.promise);
    render(<AdminPage />);
    await screen.findByText('A 가구');
    openDetails('A');
    await act(async () => a.resolve());
    fireEvent.click(screen.getByRole('button', { name: '제거', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '닫기', exact: true }));
    await act(async () => prompt.resolve('관리 사유'));
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
