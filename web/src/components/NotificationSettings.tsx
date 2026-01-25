'use client';

import { useState, useEffect } from 'react';
import {
  isPushNotificationSupported,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  isIOSPWA,
} from '@/lib/pushNotificationService';

export default function NotificationSettings() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isIOSPWAMode, setIsIOSPWAMode] = useState(false);

  useEffect(() => {
    setIsSupported(isPushNotificationSupported());
    setPermission(getNotificationPermissionStatus());
    setIsIOSPWAMode(isIOSPWA());
  }, []);

  const handleEnableNotifications = async () => {
    setIsLoading(true);
    try {
      const token = await requestNotificationPermission();
      if (token) {
        setPermission('granted');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // PWA가 아니면 홈 화면 추가 안내 (테스트용 주석 처리)
  // if (!isIOSPWAMode) {
  //   return (
  //     <div className="p-4 flex items-center gap-3">
  //       <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
  //         <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  //         </svg>
  //       </div>
  //       <div className="flex-1">
  //         <div className="font-semibold text-slate-800">홈 화면에 추가 필요</div>
  //         <div className="text-sm text-slate-500">Safari 공유 → 홈 화면에 추가</div>
  //       </div>
  //     </div>
  //   );
  // }

  // 지원하지 않는 브라우저
  if (!isSupported) {
    return null;
  }

  return (
    <div className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-800">푸시 알림</div>
        <div className="text-sm text-slate-500">
          {permission === 'granted' ? '활성화됨' : '결제 시 알림 받기'}
        </div>
      </div>
      {permission === 'granted' ? (
        <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      ) : (
        <button
          onClick={handleEnableNotifications}
          disabled={isLoading || permission === 'denied'}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            permission === 'denied'
              ? 'bg-slate-100 text-slate-400'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isLoading ? '...' : permission === 'denied' ? '거부됨' : '활성화'}
        </button>
      )}
    </div>
  );
}
