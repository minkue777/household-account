import { act, fireEvent, render, screen } from '@testing-library/react';

import HouseholdLogin from '@/components/HouseholdLogin';
import { useHousehold } from '@/contexts/HouseholdContext';

jest.mock('@/contexts/HouseholdContext', () => ({
  useHousehold: jest.fn(),
}));

const mockedUseHousehold = jest.mocked(useHousehold);

describe('첫 방문 가계부 이름 입력 계약', () => {
  it('사용자는 이름 부분만 입력하고 네 가계부 접미사를 확인한다', async () => {
    const createHouseholdForSelf = jest.fn().mockResolvedValue(undefined);
    mockedUseHousehold.mockReturnValue({
      sessionState: 'first-visit',
      sessionError: null,
      legacyCandidate: null,
      signIn: jest.fn(),
      retrySession: jest.fn(),
      confirmLegacyMembership: jest.fn(),
      createHouseholdForSelf,
      joinHouseholdAsSelf: jest.fn(),
      logout: jest.fn(),
    } as unknown as ReturnType<typeof useHousehold>);
    render(<HouseholdLogin />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '새 가계부 만들기' }));
    });

    expect(screen.getByLabelText('가계부 이름')).toHaveAttribute(
      'placeholder',
      '예: 장휘민지',
    );
    expect(screen.getByText('네 가계부')).toBeInTheDocument();

    act(() => {
      fireEvent.change(screen.getByLabelText('가계부 이름'), {
        target: { value: '장휘민지' },
      });
      fireEvent.change(screen.getByPlaceholderText('내 이름'), {
        target: { value: '민지' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '가계부 만들기' }));
    });

    expect(createHouseholdForSelf).toHaveBeenCalledWith(
      '장휘민지',
      '민지',
    );
  });
});
