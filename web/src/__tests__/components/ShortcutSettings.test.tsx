import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

  it('활성 키가 있으면 제목 영역 오른쪽에 재발급 버튼만 표시하고 폐기·시간 정보는 숨긴다', async () => {
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

    const header = screen.getByTestId('shortcut-settings-header');
    expect(await within(header).findByRole('button', { name: '재발급' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: '재발급' })).not.toBeInTheDocument();
  });

  it('[T-IOS-INSTALL-001][IOS-013] 실제 설치 화면은 Authorization 값을 복사하고 원문 없는 서버 설치 URL을 연다', async () => {
    mockStatus.mockResolvedValue({ kind: 'notFound' });
    const result = {
      kind: 'issued', credentialId: 'credential-new', credentialVersion: 1,
      rawCredential: 'one-time-secret', installUrl: 'https://www.icloud.com/shortcuts/test-install',
      issuedAt: '2026-10-05T09:00:00+09:00',
    };
    mockIssue.mockResolvedValue(result);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const view = render(<ShortcutSettings />);
      fireEvent.click(await screen.findByRole('button', { name: '키 발급 및 설치' }));
      expect(await screen.findByText('Bearer one-time-secret')).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith('Bearer one-time-secret');
      await waitFor(() => expect(open).toHaveBeenCalledWith(result.installUrl, '_blank', 'noopener,noreferrer'));
      expect(screen.getByRole('link', { name: '설치 화면 열기' })).toHaveAttribute('href', result.installUrl);

      view.unmount();
      mockStatus.mockResolvedValue({ kind: 'found', credential: { credentialId: result.credentialId, credentialVersion: 1, status: 'active' } });
      render(<ShortcutSettings />);
      await screen.findByRole('button', { name: '재발급' });
      expect(screen.queryByText('Bearer one-time-secret')).not.toBeInTheDocument();
      expect(mockRevoke).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it('[T-IOS-INSTALL-001][IOS-013] 복사 권한 거절은 발급을 되돌리지 않고 명시적 복사와 설치 링크를 보존한다', async () => {
    mockStatus.mockResolvedValue({ kind: 'notFound' });
    mockIssue.mockResolvedValue({
      kind: 'issued', credentialId: 'credential-new', credentialVersion: 1,
      rawCredential: 'recoverable-secret', installUrl: 'https://www.icloud.com/shortcuts/test-install',
      issuedAt: '2026-10-05T09:00:00+09:00',
    });
    const writeText = jest.fn().mockRejectedValueOnce(new Error('Clipboard denied')).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<ShortcutSettings />);
      fireEvent.click(await screen.findByRole('button', { name: '키 발급 및 설치' }));
      fireEvent.click(await screen.findByRole('button', { name: '키 복사' }));
      await screen.findByRole('button', { name: '복사됨' });
      expect(writeText).toHaveBeenLastCalledWith('Bearer recoverable-secret');
      expect(screen.getByRole('link', { name: '설치 화면 열기' })).toHaveAttribute('href', 'https://www.icloud.com/shortcuts/test-install');
      expect(open).not.toHaveBeenCalled();
      expect(mockIssue).toHaveBeenCalledTimes(1);
      expect(mockRevoke).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it('[T-IOS-SEC-002][IOS-013] 다른 요청에서 이미 발급했으면 상태만 재조회하고 키나 설치 화면을 다시 노출하지 않는다', async () => {
    mockStatus.mockResolvedValueOnce({ kind: 'notFound' }).mockResolvedValue({
      kind: 'found', credential: { credentialId: 'existing', credentialVersion: 2, status: 'active' },
    });
    mockIssue.mockResolvedValue({ kind: 'alreadyIssued', credentialId: 'existing', credentialVersion: 2 });
    render(<ShortcutSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '키 발급 및 설치' }));
    await screen.findByText('이미 발급된 키는 다시 볼 수 없습니다. 필요하면 재발급해 주세요.');
    expect(screen.queryByRole('link', { name: '설치 화면 열기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재발급' })).toBeInTheDocument();
    expect(mockStatus).toHaveBeenCalledTimes(2);
  });
});
