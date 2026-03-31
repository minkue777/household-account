'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import NotificationSettings from '@/components/NotificationSettings';
import { isIOS } from '@/lib/pushNotificationService';
import {
  CategorySettings,
  MerchantRuleSettings,
  RecurringExpenseSettings,
  ThemeSettings,
} from '@/components/settings';
import { AndroidBridge } from '@/lib/bridges/androidBridge';

export default function SettingsPage() {
  const { isLoading } = useCategoryContext();
  const { currentMember, household, switchMember } = useHousehold();

  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [appVersionLabel, setAppVersionLabel] = useState<string | null>(null);

  useEffect(() => {
    setIsIOSDevice(isIOS());
    setAppVersionLabel(AndroidBridge.getAppVersion());
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-400">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-4">
          <Link href="/" className="rounded-lg p-2 transition-colors hover:bg-slate-100">
            <svg className="h-5 w-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-slate-800">설정</h1>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        {currentMember && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                  <span className="text-lg font-bold text-blue-600">{currentMember.name[0]}</span>
                </div>
                <div>
                  <p className="font-medium text-slate-800">{currentMember.name}</p>
                  <p className="text-xs text-slate-400">{household?.name || '가계부'}</p>
                </div>
              </div>
              <button
                onClick={switchMember}
                className="text-sm text-slate-400 transition-colors hover:text-slate-600"
              >
                변경
              </button>
            </div>
          </div>
        )}

        <CategorySettings />
        <MerchantRuleSettings />
        <RecurringExpenseSettings />
        <ThemeSettings />

        {isIOSDevice && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <NotificationSettings />
          </div>
        )}

        {appVersionLabel && (
          <div className="px-1 pb-2 pt-1 text-center text-xs text-slate-400">
            {appVersionLabel}
          </div>
        )}
      </div>
    </div>
  );
}
