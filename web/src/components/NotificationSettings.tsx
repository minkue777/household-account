'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2 } from 'lucide-react';
import {
  getFidEndpointRegistrationState,
  getNotificationPermissionStatus,
  isIOSPWA,
  isPushNotificationSupported,
  refreshFcmToken,
  requestNotificationPermission,
  subscribeFidEndpointRegistrationState,
  type PwaFidEndpointRegistrationState,
} from '@/lib/pushNotificationService';

export default function NotificationSettings() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpointState, setEndpointState] = useState<PwaFidEndpointRegistrationState>({
    status: 'idle',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isIOSPWAMode, setIsIOSPWAMode] = useState(false);

  useEffect(() => {
    setIsSupported(isPushNotificationSupported());
    setPermission(getNotificationPermissionStatus());
    setIsIOSPWAMode(isIOSPWA());
    setEndpointState(getFidEndpointRegistrationState());
    return subscribeFidEndpointRegistrationState(setEndpointState);
  }, []);

  const handleEnableNotifications = async () => {
    setIsLoading(true);
    try {
      if (permission === 'granted') await refreshFcmToken();
      else await requestNotificationPermission();
      setPermission(getNotificationPermissionStatus());
    } catch {
      setPermission(getNotificationPermissionStatus());
    } finally {
      setIsLoading(false);
    }
  };

  if (!isIOSPWAMode) {
    return (
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-slate-800">홈 화면에 추가 필요</div>
          <div className="text-sm text-slate-500">Safari 공유 메뉴에서 홈 화면에 추가해 주세요</div>
        </div>
      </div>
    );
  }

  if (!isSupported) return null;

  const isActive = permission === 'granted' && endpointState.status === 'active';
  const isRegistering = isLoading || endpointState.status === 'registering';
  const isUnavailable = endpointState.status === 'unsupported';

  const statusLabel = (() => {
    if (permission === 'denied') return '브라우저에서 알림 권한이 거부됨';
    if (isUnavailable) return '이 환경에서는 알림을 지원하지 않음';
    if (isRegistering) return '알림 연결 확인 중';
    if (isActive) return '활성화됨';
    if (permission === 'granted') return '서버 연결 필요';
    return '결제 등록 알림 받기';
  })();

  return (
    <div className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
        <Bell className="h-5 w-5 text-purple-600" />
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-800">알림 설정</div>
        <div className="text-sm text-slate-500">{statusLabel}</div>
      </div>
      {isActive ? (
        <CheckCircle2 className="h-6 w-6 text-green-500" aria-label="알림 연결 완료" />
      ) : (
        <button
          onClick={handleEnableNotifications}
          disabled={isRegistering || isUnavailable || permission === 'denied'}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isUnavailable || permission === 'denied'
              ? 'bg-slate-100 text-slate-400'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isRegistering
            ? '...'
            : permission === 'denied'
              ? '거부됨'
              : permission === 'granted'
                ? '재연결'
                : '활성화'}
        </button>
      )}
    </div>
  );
}
