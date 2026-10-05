import { act, render, screen } from '@testing-library/react';
import { useHomePreferences } from '@/features/home-preferences/homePreferences';
import { subscribeToHomePreferencesDocument } from '@/platform/read-model/homePreferencesReadModel';
import { clearClientSessionScope, setClientSessionScope } from '@/composition/clientSessionScope';
import { DEFAULT_HOME_SUMMARY_CONFIG, type HomeSummaryConfig } from '@/types/household';

const mockListen = jest.fn();
let mockHousehold: { householdKey: string; remoteReadEpoch: number; household: {
  homeSummaryConfig: HomeSummaryConfig; homeSummaryConfigVersion: number;
} };
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => mockHousehold }));
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {}, doc: (...parts: unknown[]) => parts,
  onDocumentSnapshot: (...args: unknown[]) => mockListen(...args),
}));
jest.mock('@/platform/read-model/initialHomeRead', () => ({
  subscribeWithInitialHomeRead: ({ listen }: { listen(): () => void }) => listen(),
}));
jest.mock('@/platform/performance/clientStartupDiagnostics', () => ({ recordClientStartupTiming: jest.fn() }));

function Probe() {
  const preference = useHomePreferences();
  return <output data-testid="cards" data-version={preference.version} data-error={String(preference.error)}>
    {preference.configuration.leftCard}/{preference.configuration.rightCard}
  </output>;
}
function next(index: number, data?: Record<string, unknown>, fromCache = false) {
  const callback = mockListen.mock.calls[index]?.[2];
  expect(callback).toEqual(expect.any(Function));
  act(() => callback({ metadata: { fromCache }, data: () => data }));
}
beforeEach(() => {
  mockListen.mockReset().mockReturnValue(jest.fn());
  mockHousehold = { householdKey: 'house-a', remoteReadEpoch: 0,
    household: { homeSummaryConfig: DEFAULT_HOME_SUMMARY_CONFIG, homeSummaryConfigVersion: 0 } };
  setClientSessionScope({ principalUid: 'user', memberId: 'member', householdId: 'house-a', sessionGeneration: 1 });
});
afterEach(clearClientSessionScope);

it('[T-HOME-003] 실제 조회 hook이 기본값에서 전달받은 canonical 구성·버전으로 갱신한다', () => {
  render(<Probe />);
  expect(screen.getByTestId('cards')).toHaveTextContent('monthlySpent/monthlyRemainingBudget');
  next(0, { left: 'YEARLY_EXPENSE', right: 'LOCAL_CURRENCY_BALANCE', aggregateVersion: 4 });
  expect(screen.getByTestId('cards')).toHaveTextContent('yearlySpent/localCurrencyBalance');
  expect(screen.getByTestId('cards')).toHaveAttribute('data-version', '4');
  next(0, { left: 'MONTHLY_EXPENSE', aggregateVersion: 1 }, true);
  expect(screen.getByTestId('cards')).toHaveTextContent('yearlySpent/localCurrencyBalance');
  expect(screen.getByTestId('cards')).toHaveAttribute('data-version', '4');
});

it('[T-HOME-003] 이미 열린 지역화폐 구독과 hook은 같은 문서 상태를 사용하고 metadata 변경이 새 설정을 덮지 않는다', () => {
  const currency = jest.fn();
  const stop = subscribeToHomePreferencesDocument('house-a', currency);
  next(0, { left: 'YEARLY_EXPENSE', right: 'LOCAL_CURRENCY_BALANCE', aggregateVersion: 3 });
  const view = render(<Probe />);
  expect(mockListen).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('cards')).toHaveTextContent('yearlySpent/localCurrencyBalance');
  mockHousehold = { ...mockHousehold, household: { homeSummaryConfig: {
    leftCard: 'monthlyRemainingBudget', rightCard: 'monthlySpent',
  }, homeSummaryConfigVersion: 1 } };
  view.rerender(<Probe />);
  expect(screen.getByTestId('cards')).toHaveTextContent('yearlySpent/localCurrencyBalance');
  next(0, { left: 'MONTHLY_EXPENSE', right: 'YEARLY_EXPENSE', aggregateVersion: 4 });
  expect(screen.getByTestId('cards')).toHaveTextContent('monthlySpent/yearlySpent');
  expect(currency).toHaveBeenLastCalledWith(expect.objectContaining({ aggregateVersion: 4 }));
  stop();
});

it('[T-HOME-003] 기존 중복 구성은 그대로 읽고 누락·미지원 값만 가구 기본값으로 해석한다', () => {
  render(<Probe />);
  next(0, { left: 'YEARLY_EXPENSE', right: 'YEARLY_EXPENSE', aggregateVersion: 2 });
  expect(screen.getByTestId('cards')).toHaveTextContent('yearlySpent/yearlySpent');
  next(0, { left: 'UNKNOWN', right: 'YEARLY_EXPENSE', aggregateVersion: 3 });
  expect(screen.getByTestId('cards')).toHaveTextContent('monthlySpent/yearlySpent');
});

it('[T-SYS-008][T-HOME-003] 다른 가구로 이동하면 이전 callback과 오류는 새 화면에 영향을 주지 않는다', () => {
  const view = render(<Probe />);
  next(0, { left: 'YEARLY_EXPENSE', right: 'LOCAL_CURRENCY_BALANCE', aggregateVersion: 9 });
  setClientSessionScope({ principalUid: 'user-b', memberId: 'member-b', householdId: 'house-b', sessionGeneration: 2 });
  mockHousehold = { ...mockHousehold, householdKey: 'house-b' };
  view.rerender(<Probe />);
  expect(screen.getByTestId('cards')).toHaveTextContent('monthlySpent/monthlyRemainingBudget');
  next(0, { left: 'YEARLY_EXPENSE', right: 'LOCAL_CURRENCY_BALANCE', aggregateVersion: 10 });
  act(() => mockListen.mock.calls[0][3](new Error('late')));
  expect(screen.getByTestId('cards')).toHaveTextContent('monthlySpent/monthlyRemainingBudget');
  expect(screen.getByTestId('cards')).toHaveAttribute('data-error', 'false');
  next(1, { left: 'MONTHLY_EXPENSE', right: 'YEARLY_EXPENSE', aggregateVersion: 1 });
  expect(screen.getByTestId('cards')).toHaveTextContent('monthlySpent/yearlySpent');
});
