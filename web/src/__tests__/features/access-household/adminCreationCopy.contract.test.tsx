import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminPage from '@/app/admin/page';
import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

const mockDashboard = jest.fn();
const mockCreate = jest.fn();
const mockShareKey = jest.fn();
const mockWriteText = jest.fn();
jest.mock('@/features/access-household/application/adminHouseholds', () => ({
  adminHouseholds: { dashboard: (...args: unknown[]) => mockDashboard(...args), create: (...args: unknown[]) => mockCreate(...args), getLegacyShareKey: (...args: unknown[]) => mockShareKey(...args) },
}));
jest.mock('@/lib/authService', () => ({
  onAuthChange: (callback: (user: unknown) => void) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; },
  logOut: jest.fn(), signInWithGoogle: jest.fn(),
}));
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showConfirm: jest.fn(), showPrompt: jest.fn() }) }));
jest.mock('@/features/access-household/application/assetOwnerProfiles', () => ({ assetOwnerProfiles: {} }));
jest.mock('@/platform/functions-api', () => ({ AdminAccessError: class extends Error {} }));
jest.mock('@/components/admin/AdminOperationsOverview', () => ({ AdminOperationsOverview: () => <div>대시보드</div> }));
jest.mock('@/components/admin/AdminHouseholdList', () => ({ AdminHouseholdList: ({ copiedKey }: { copiedKey?: string }) => <div>{copiedKey ? '복사 완료' : ''}</div> }));

const dashboardFixture = (): AdminOperationsDashboardWireView => ({
  generatedAt: '2026-09-16T00:00:00Z',
  service: { apiStatus: 'online', health: 'healthy', serviceName: 'admin', revision: 'test', region: 'asia-northeast3' },
  summary: { activeHouseholds: 0, deletedHouseholds: 0, activeMembers: 0, todayAccessCount: 0, totalAccessCount: 0, unhealthyProviders: 0, openIncidents: 0 },
  households: [], dailyAccess: [], scheduledJobs: [], providerHealth: [], incidents: [],
  functionLatency: { status: 'available', windowHours: 24, operations: [] }, billingCost: { status: 'unavailable' },
});

describe('관리자 가구 생성 후 키 복사', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDashboard.mockResolvedValue(dashboardFixture());
    mockCreate.mockResolvedValue({ householdId: 'new-household' });
    mockShareKey.mockResolvedValue({ legacyShareKey: 'generated-share-key' });
    mockWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mockWriteText } });
  });

  it.each([false, true])('[ADM-001] 생성 뒤 공유 키를 자동 복사하고 복사 실패=%s도 생성 성공과 구분한다', async failure => {
    if (failure) mockWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    render(<AdminPage />);
    await screen.findByText('대시보드');
    fireEvent.change(screen.getByPlaceholderText('가구 이름'), { target: { value: ' 새 가구 ' } });
    fireEvent.click(screen.getByRole('button', { name: '생성' }));
    await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith('generated-share-key'));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith('새 가구');
    expect(mockShareKey).toHaveBeenCalledWith('new-household');
    expect(mockDashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByPlaceholderText('가구 이름')).toHaveValue('');
    expect(await screen.findByText(failure ? '가구 키를 복사하지 못했습니다.' : '복사 완료')).toBeInTheDocument();
    expect(screen.queryByText('가구를 생성하지 못했습니다.')).not.toBeInTheDocument();
  });
  it('열린 장애를 빠르게 갱신하되 중복 요청을 막고 복구 후 정상 갱신 주기로 돌아간다', async () => {
    jest.useFakeTimers();
    const healthy = dashboardFixture();
    let resolve!: (value: AdminOperationsDashboardWireView) => void;
    const pending = new Promise<AdminOperationsDashboardWireView>(done => { resolve = done; });
    mockDashboard.mockResolvedValueOnce({ ...healthy, service: { ...healthy.service, health: 'critical' } })
      .mockImplementationOnce(() => pending).mockResolvedValue(healthy);
    const view = render(<AdminPage />);
    try {
      await act(async () => {});
      expect(mockDashboard).toHaveBeenCalledTimes(1);
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(mockDashboard).toHaveBeenCalledTimes(2);
      await act(async () => { window.dispatchEvent(new Event('focus')); jest.advanceTimersByTime(10_000); });
      expect(mockDashboard).toHaveBeenCalledTimes(2);
      await act(async () => { resolve(healthy); });
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(mockDashboard).toHaveBeenCalledTimes(2);
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      expect(mockDashboard).toHaveBeenCalledTimes(3);
    } finally { view.unmount(); jest.useRealTimers(); }
  });

});
