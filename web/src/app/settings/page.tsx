'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import { useHousehold } from '@/contexts/HouseholdContext';
import { useTheme } from '@/contexts/ThemeContext';
import NotificationSettings from '@/components/NotificationSettings';
import { isIOS } from '@/lib/pushNotificationService';
import {
  CardSettings,
  CategorySettings,
  MerchantRuleSettings,
  RecurringExpenseSettings,
  ThemeSettings,
} from '@/components/settings';
import { AndroidBridge } from '@/lib/bridges/androidBridge';

export default function SettingsPage() {
  const { isLoading } = useCategoryContext();
  const { currentMember, household, switchMember } = useHousehold();
  const { themeConfig } = useTheme();

  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [appVersionLabel, setAppVersionLabel] = useState<string | null>(null);

  useEffect(() => {
    setIsIOSDevice(isIOS());
    setAppVersionLabel(AndroidBridge.getAppVersion());
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-400">로딩 중...</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <div className="mb-2 flex items-center gap-4">
            <Link href="/" className="text-slate-500 transition-colors hover:text-slate-700">
              <ArrowLeft className="h-6 w-6" />
            </Link>
            <h1
              className="text-lg md:text-xl font-bold"
              style={{
                background: themeConfig.titleGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              설정
            </h1>
          </div>
        </header>

        <div className="space-y-4">
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

          <CardSettings
            householdId={household?.id}
            ownerName={currentMember?.name}
          />
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
    </main>
  );
}
