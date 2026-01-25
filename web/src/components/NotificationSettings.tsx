'use client';

import { useState, useEffect } from 'react';
import {
  isPushNotificationSupported,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  isIOS,
  isIOSPWA,
} from '@/lib/pushNotificationService';

export default function NotificationSettings() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [isIOSPWAMode, setIsIOSPWAMode] = useState(false);

  useEffect(() => {
    setIsSupported(isPushNotificationSupported());
    setPermission(getNotificationPermissionStatus());
    setIsIOSDevice(isIOS());
    setIsIOSPWAMode(isIOSPWA());
  }, []);

  const handleEnableNotifications = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await requestNotificationPermission();
      if (token) {
        setPermission('granted');
      } else {
        setError('알림 권한을 얻지 못했습니다.');
      }
    } catch (err) {
      setError('알림 설정 중 오류가 발생했습니다.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // iOS인데 PWA가 아닌 경우
  if (isIOSDevice && !isIOSPWAMode) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="font-semibold text-amber-800 mb-2">
          iOS 푸시 알림 안내
        </h3>
        <p className="text-sm text-amber-700 mb-3">
          iOS에서 푸시 알림을 받으려면 이 앱을 홈 화면에 추가해야 합니다.
        </p>
        <div className="text-sm text-amber-700 space-y-1">
          <p>1. Safari에서 공유 버튼(□↑)을 탭합니다</p>
          <p>2. &quot;홈 화면에 추가&quot;를 선택합니다</p>
          <p>3. 홈 화면에서 앱을 열고 알림을 활성화합니다</p>
        </div>
      </div>
    );
  }

  // 지원하지 않는 브라우저
  if (!isSupported) {
    return (
      <div className="bg-slate-100 rounded-xl p-4">
        <p className="text-sm text-slate-600">
          이 브라우저는 푸시 알림을 지원하지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-800">푸시 알림</h3>
          <p className="text-sm text-slate-500">
            {isIOSPWAMode ? 'iOS' : 'Android'}에서 결제하면 알림을 받습니다
          </p>
        </div>

        {permission === 'granted' ? (
          <div className="flex items-center gap-2 text-green-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium">활성화됨</span>
          </div>
        ) : (
          <button
            onClick={handleEnableNotifications}
            disabled={isLoading || permission === 'denied'}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              permission === 'denied'
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                설정 중...
              </span>
            ) : permission === 'denied' ? (
              '권한 거부됨'
            ) : (
              '알림 활성화'
            )}
          </button>
        )}
      </div>

      {permission === 'denied' && (
        <p className="text-xs text-red-500">
          알림 권한이 거부되었습니다. 브라우저 설정에서 알림 권한을 허용해주세요.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-500 mt-2">{error}</p>
      )}

      {permission === 'granted' && (
        <div className="mt-3 p-3 bg-blue-50 rounded-lg">
          <p className="text-xs text-blue-700">
            Android 기기에서 카드 결제 시 이 기기로 알림이 전송됩니다.
            알림을 탭하면 바로 수정 화면으로 이동합니다.
          </p>
        </div>
      )}
    </div>
  );
}
