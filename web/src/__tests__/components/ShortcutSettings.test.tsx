import { render, screen } from '@testing-library/react';

import ShortcutSettings from '@/components/settings/ShortcutSettings';

const mockStatus = jest.fn();
const mockIssue = jest.fn();
const mockReissue = jest.fn();
const mockRevoke = jest.fn();

jest.mock('@/features/payment-capture/application/shortcutCredentials', () => ({
  shortcutAuthorizationValue: (value: string) => `Bearer ${value}`,
  shortcutCredentials: {
    status: (...args: unknown[]) => mockStatus(...args),
    issue: (...args: unknown[]) => mockIssue(...args),
    reissue: (...args: unknown[]) => mockReissue(...args),
    revoke: (...args: unknown[]) => mockRevoke(...args),
  },
}));

describe('iPhone 결제 자동 등록 설정', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('활성 키가 있으면 강조된 재발급 버튼만 표시하고 폐기·시간 정보는 숨긴다', async () => {
    mockStatus.mockResolvedValue({
      kind: 'found',
      credential: {
        credentialId: 'credential-1',
        credentialVersion: 3,
        status: 'active',
        masked: true,
        issuedAt: '2026-07-20T10:00:00+09:00',
        lastUsedAt: '2026-07-22T11:00:00+09:00',
      },
    });

    render(<ShortcutSettings />);

    expect(await screen.findByRole('button', { name: '키 재발급' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText('폐기')).not.toBeInTheDocument();
    expect(screen.queryByText(/최근 사용/)).not.toBeInTheDocument();
    expect(screen.queryByText(/발급되어 있습니다/)).not.toBeInTheDocument();
  });

  it('발급된 키가 없으면 최초 발급 및 설치 버튼을 표시한다', async () => {
    mockStatus.mockResolvedValue({ kind: 'notFound' });

    render(<ShortcutSettings />);

    expect(
      await screen.findByRole('button', { name: '키 발급 및 설치' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '키 재발급' })).not.toBeInTheDocument();
  });
});
