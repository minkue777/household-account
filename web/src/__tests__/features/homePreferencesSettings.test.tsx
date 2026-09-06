import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HomePreferencesSettings from '@/components/settings/HomePreferencesSettings';
import { homePreferenceCommands } from '@/features/home-preferences/homePreferences';
let mockPreference = { configuration: { leftCard: 'monthlySpent', rightCard: 'monthlyRemainingBudget' }, version: 1, selectedType: 'gyeonggi', error: false };
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: 'house-1', adminHouseholdView: null }) }));
jest.mock('@/features/home-preferences/homePreferences', () => ({
  HOME_CARD_LABELS: { localCurrencyBalance: '지역화폐 잔액', monthlyRemainingBudget: '월 잔여 예산', monthlySpent: '월 지출', yearlySpent: '연 지출' },
  useHomePreferences: () => mockPreference, useAvailableHomeCurrencies: () => ({ types: ['gyeonggi', 'daejeon'], error: false }),
  homePreferenceCommands: { saveCards: jest.fn(), selectCurrency: jest.fn() },
}));
it('retains the edit version through concurrent updates, preserves rejected draft and saves currency separately', async () => {
  const { rerender } = render(<HomePreferencesSettings />);
  fireEvent.change(screen.getByLabelText('오른쪽 카드'), { target: { value: 'yearlySpent' } });
  mockPreference = { ...mockPreference, version: 2 }; rerender(<HomePreferencesSettings />);
  jest.mocked(homePreferenceCommands.saveCards).mockRejectedValueOnce(new Error('CONFLICT'));
  fireEvent.click(screen.getByText('카드 저장'));
  await screen.findByText('저장하지 못했습니다. 다른 가구원이 변경했다면 최신 설정을 다시 불러와 주세요.');
  expect(homePreferenceCommands.saveCards).toHaveBeenCalledWith('house-1', { leftCard: 'monthlySpent', rightCard: 'yearlySpent' }, 1);
  expect(screen.getByLabelText('오른쪽 카드')).toHaveValue('yearlySpent');
  fireEvent.click(screen.getByText('최신 설정 다시 불러오기'));
  fireEvent.change(screen.getByLabelText('홈 지역화폐'), { target: { value: 'daejeon' } });
  await waitFor(() => expect(homePreferenceCommands.selectCurrency).toHaveBeenCalledWith('house-1', 'daejeon', 2));
});
it('reads legacy duplicate cards unchanged but refuses saving a new duplicate', async () => {
  mockPreference = { ...mockPreference, configuration: { leftCard: 'monthlySpent', rightCard: 'monthlySpent' } };
  render(<HomePreferencesSettings />);
  expect(screen.getByLabelText('오른쪽 카드')).toHaveValue('monthlySpent');
  fireEvent.change(screen.getByLabelText('왼쪽 카드'), { target: { value: 'monthlySpent' } });
  fireEvent.click(screen.getByText('카드 저장'));
  await screen.findByText('서로 다른 두 카드를 선택해 주세요.');
});
