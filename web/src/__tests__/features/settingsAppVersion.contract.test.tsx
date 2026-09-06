import { render, screen } from '@testing-library/react';
import SettingsPage from '@/app/settings/page';
import { AndroidBridge } from '@/lib/bridges/androidBridge';

jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({ isLoading: false }) }));
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ currentMember: null, household: null, logout: jest.fn() }) }));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ themeConfig: {} }) }));
jest.mock('@/lib/pushNotificationService', () => ({ isIOS: () => false }));
jest.mock('@/components/NotificationSettings', () => () => null);
jest.mock('@/components/settings/HomePreferencesSettings', () => () => null);
jest.mock('@/components/settings', () => ({
  CardSettings: () => null, CategorySettings: () => null, MerchantRuleSettings: () => null,
  QuickEditOverlaySettings: () => null, RecurringExpenseSettings: () => null,
  ThemeSettings: () => null, InvitationSettings: () => null, ShortcutSettings: () => null,
}));
jest.mock('@/lib/bridges/androidBridge', () => ({ AndroidBridge: { isAvailable: jest.fn(), getAppVersion: jest.fn() } }));

describe('설정의 실제 Android 버전 표시', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(AndroidBridge.isAvailable).mockReturnValue(true); });
  it('Native versionName을 계약 문구와 함께 표시한다', async () => {
    jest.mocked(AndroidBridge.getAppVersion).mockResolvedValue('1.2.21');
    render(<SettingsPage />);
    expect(await screen.findByText('현재 앱 버전: 1.2.21')).toBeInTheDocument();
  });
  it('bridge 실패에도 알 수 없음 표시를 유지한다', async () => {
    jest.mocked(AndroidBridge.getAppVersion).mockRejectedValue(new Error('bridge unavailable'));
    render(<SettingsPage />);
    expect(await screen.findByText('현재 앱 버전: 알 수 없음')).toBeInTheDocument();
  });
  it('일반 Web에서는 Native bridge를 호출하거나 버전을 표시하지 않는다', () => {
    jest.mocked(AndroidBridge.isAvailable).mockReturnValue(false);
    render(<SettingsPage />);
    expect(AndroidBridge.getAppVersion).not.toHaveBeenCalled();
    expect(screen.queryByText(/현재 앱 버전:/)).not.toBeInTheDocument();
  });
});
