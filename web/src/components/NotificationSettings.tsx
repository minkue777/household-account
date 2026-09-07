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
import {
  formatPwaEndpointRegistrationErrorCode,
  type PwaEndpointRegistrationPhase,
} from '@/platform/pwa/pwaEndpointRegistrationDiagnostic';

const PHASE_LABELS: Record<PwaEndpointRegistrationPhase, string> = {
  worker: '알림 실행 준비',
  installation: '알림 기기 확인',
  subscription: '아이폰 푸시 구독 확인',
  'prime-registration': '푸시 서비스 확인',
  unregister: '기존 푸시 연결 정리',
  'push-registration': '푸시 서비스 연결',
  'server-registration': '가계부 서버 연결',
  verification: '알림 연결 검증',
  'legacy-cleanup': '이전 알림 연결 정리',
};

type ConnectionFailure = { errorCode: string; phase?: PwaEndpointRegistrationPhase };

export default function NotificationSettings() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpointState, setEndpointState] = useState<PwaFidEndpointRegistrationState>({
    status: 'idle',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isIOSPWAMode, setIsIOSPWAMode] = useState(false);
  const [requestFailure, setRequestFailure] = useState<ConnectionFailure>();

  useEffect(() => {
    setIsSupported(isPushNotificationSupported());
    setPermission(getNotificationPermissionStatus());
    setIsIOSPWAMode(isIOSPWA());
    setEndpointState(getFidEndpointRegistrationState());
    return subscribeFidEndpointRegistrationState(next => {
      setEndpointState(next);
      if (next.status !== 'error') setRequestFailure(undefined);
    });
  }, []);

  const handleEnableNotifications = async () => {
    setRequestFailure(undefined);
    setIsLoading(true);
    try {
      if (permission === 'granted') await refreshFcmToken();
      else await requestNotificationPermission();
      setPermission(getNotificationPermissionStatus());
    } catch (error) {
      const latest = getFidEndpointRegistrationState();
      const errorCode = formatPwaEndpointRegistrationErrorCode(error);
      setEndpointState(latest);
      setRequestFailure({
        errorCode,
        ...(latest.status === 'error' && latest.errorCode === errorCode ? { phase: latest.phase } : {}),
      });
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

  const failure = requestFailure ?? (endpointState.status === 'error'
    ? { errorCode: endpointState.errorCode ?? 'unknown', phase: endpointState.phase } : undefined);
  const isActive = permission === 'granted' && endpointState.status === 'active' && !failure;
  const isRegistering = isLoading || endpointState.status === 'registering';
  const isUnavailable = endpointState.status === 'unsupported';

  const statusLabel = (() => {
    if (permission === 'denied') return '브라우저에서 알림 권한이 거부됨';
    if (isUnavailable) return '이 환경에서는 알림을 지원하지 않음';
    if (isRegistering) return endpointState.status === 'registering' && endpointState.phase
      ? `${PHASE_LABELS[endpointState.phase]} 중` : '알림 연결 확인 중';
    if (isActive) return '활성화됨';
    if (failure) return '알림 연결 실패';
    if (permission === 'granted') return '알림 연결 필요';
    return '결제 등록 알림 받기';
  })();

  return (
    <div className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
        <Bell className="h-5 w-5 text-purple-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-slate-800">알림 설정</div>
        <div className="text-sm text-slate-500">{statusLabel}</div>
        {failure && !isRegistering && !isUnavailable && permission !== 'denied' && (
          <div role="alert" className="mt-1 select-text break-words text-xs text-rose-600">
            <div>실패 단계: {failure.phase ? PHASE_LABELS[failure.phase] : '알림 연결 시작'}</div>
            <div className="break-all">오류 코드: <code>{failure.errorCode}</code></div>
          </div>
        )}
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
