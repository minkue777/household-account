'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Bell, CheckCircle2 } from 'lucide-react';
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
    } finally {
      setIsLoading(false);
    }
  };

  // PWA가 아니면 홈 화면 추가 안내
  if (!isIOSPWAMode) {
    return (
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-slate-800">홈 화면에 추가 필요</div>
          <div className="text-sm text-slate-500">Safari 공유 → 홈 화면에 추가</div>
        </div>
      </div>
    );
  }

  // 지원하지 않는 브라우저
  if (!isSupported) {
    return null;
  }

  return (
    <div className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
        <Bell className="h-5 w-5 text-purple-600" />
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-800">알림 설정</div>
        <div className="text-sm text-slate-500">
          {permission === 'granted' ? '활성화됨' : '결제 시 알림 받기'}
        </div>
      </div>
      {permission === 'granted' ? (
        <CheckCircle2 className="h-6 w-6 text-green-500" />
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
