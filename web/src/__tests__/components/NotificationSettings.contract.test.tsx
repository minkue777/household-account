import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockPermission: NotificationPermission = 'granted';
let mockEndpointState: { status: string; registrationVersion?: number } = { status: 'error' };
const mockRefreshFcmToken = jest.fn(async () => true);

jest.mock('@/lib/pushNotificationService', () => ({
  getFidEndpointRegistrationState: jest.fn(() => mockEndpointState),
  getNotificationPermissionStatus: jest.fn(() => mockPermission),
  isIOSPWA: jest.fn(() => true),
  isPushNotificationSupported: jest.fn(() => true),
  refreshFcmToken: () => mockRefreshFcmToken(),
  requestNotificationPermission: jest.fn(async () => true),
  subscribeFidEndpointRegistrationState: jest.fn(() => jest.fn()),
}));

import NotificationSettings from '@/components/NotificationSettings';

describe('iPhone PWA 알림 설정 표시 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission = 'granted';
    mockEndpointState = { status: 'error' };
  });

  it('브라우저 권한이 있어도 서버 등록이 실패했으면 재연결이 필요하다고 표시한다', async () => {
    render(<NotificationSettings />);

    expect(await screen.findByText('서버 연결 필요')).toBeInTheDocument();
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
});
