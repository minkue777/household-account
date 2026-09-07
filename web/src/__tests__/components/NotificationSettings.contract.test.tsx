import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { PwaFidEndpointRegistrationState } from '@/lib/pushNotificationService';

let mockPermission: NotificationPermission = 'granted';
let mockEndpointState: PwaFidEndpointRegistrationState = { status: 'error' };
let mockEndpointListener: ((state: PwaFidEndpointRegistrationState) => void) | undefined;
const mockRefreshFcmToken = jest.fn(async () => true);

jest.mock('@/lib/pushNotificationService', () => ({
  getFidEndpointRegistrationState: jest.fn(() => mockEndpointState),
  getNotificationPermissionStatus: jest.fn(() => mockPermission),
  isIOSPWA: jest.fn(() => true),
  isPushNotificationSupported: jest.fn(() => true),
  refreshFcmToken: () => mockRefreshFcmToken(),
  requestNotificationPermission: jest.fn(async () => true),
  subscribeFidEndpointRegistrationState: jest.fn((listener) => {
    mockEndpointListener = listener;
    return jest.fn();
  }),
}));

import NotificationSettings from '@/components/NotificationSettings';

describe('iPhone PWA 알림 설정 표시 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission = 'granted';
    mockEndpointState = { status: 'error' };
    mockEndpointListener = undefined;
    mockRefreshFcmToken.mockReset().mockResolvedValue(true);
  });

  it('브라우저 권한이 있어도 서버 등록이 실패했으면 재연결이 필요하다고 표시한다', async () => {
    render(<NotificationSettings />);

    expect(await screen.findByText('알림 연결 실패')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '재연결' }));

    await waitFor(() => expect(mockRefreshFcmToken).toHaveBeenCalledTimes(1));
  });

  it('서버 endpoint 등록이 확인된 경우에만 활성화됨을 표시한다', async () => {
    mockEndpointState = { status: 'active', registrationVersion: 4 };

    render(<NotificationSettings />);

    expect(await screen.findByText('활성화됨')).toBeInTheDocument();
    expect(screen.getByLabelText('알림 연결 완료')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '재연결' })).not.toBeInTheDocument();
  });

  it('진행 단계와 실패 코드를 표시하고 성공한 재연결 뒤에는 이전 오류를 지운다', async () => {
    let rejectRegistration!: (error: unknown) => void;
    mockRefreshFcmToken.mockImplementationOnce(() => new Promise((_, reject) => { rejectRegistration = reject; }));
    render(<NotificationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '재연결' }));
    act(() => {
      mockEndpointState = { status: 'registering', phase: 'subscription' };
      mockEndpointListener?.(mockEndpointState);
    });
    expect(screen.getByText('아이폰 푸시 구독 확인 중')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const errorCode = 'messaging/fid-unregister-failed';
    await act(async () => {
      mockEndpointState = { status: 'error', phase: 'unregister', errorCode };
      mockEndpointListener?.(mockEndpointState);
      rejectRegistration(Object.assign(new Error('private-fid-and-provider-url'), { code: errorCode }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('실패 단계: 기존 푸시 연결 정리');
    expect(screen.getByRole('alert')).toHaveTextContent(errorCode);
    expect(screen.queryByText(/private-fid/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재연결' })).toBeEnabled();

    mockRefreshFcmToken.mockImplementationOnce(async () => {
      mockEndpointState = { status: 'active', registrationVersion: 5 };
      mockEndpointListener?.(mockEndpointState);
      return true;
    });
    fireEvent.click(screen.getByRole('button', { name: '재연결' }));
    await screen.findByLabelText('알림 연결 완료');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('등록 시작 전 오류도 숨기지 않고 안전한 코드만 표시한다', async () => {
    mockEndpointState = { status: 'idle' };
    mockRefreshFcmToken.mockRejectedValueOnce(new Error('PWA_SESSION_CLEANUP_REQUIRED'));
    render(<NotificationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '재연결' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PWA_SESSION_CLEANUP_REQUIRED');
    expect(screen.getByRole('button', { name: '재연결' })).toBeEnabled();
  });

  it('알 수 없는 예외의 메시지와 식별자를 화면에 노출하지 않는다', async () => {
    mockRefreshFcmToken.mockRejectedValueOnce(Object.assign(new Error('private-fid-provider-url'), { code: 'private-account-identifier' }));
    render(<NotificationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '재연결' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown');
    expect(screen.queryByText(/private-/)).not.toBeInTheDocument();
  });
});
