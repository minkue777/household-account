'use client';

import { useState, useEffect } from 'react';
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

export default function SettingsPage() {
  const { isLoading } = useCategoryContext();
  const { currentMember, household, switchMember } = useHousehold();

  // iOS 여부
  const [isIOSDevice, setIsIOSDevice] = useState(false);

  useEffect(() => {
    setIsIOSDevice(isIOS());
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400">로딩중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-slate-800">설정</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* 내 정보 섹션 */}
        {currentMember && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-blue-600 font-bold text-lg">{currentMember.name[0]}</span>
                </div>
                <div>
                  <p className="font-medium text-slate-800">{currentMember.name}</p>
                  <p className="text-xs text-slate-400">{household?.name || '가계부'}</p>
                </div>
              </div>
              <button
                onClick={switchMember}
                className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
              >
                변경
              </button>
            </div>
          </div>
        )}

        {/* 카테고리 섹션 */}
        <CategorySettings />

        {/* 가맹점 규칙 섹션 */}
        <MerchantRuleSettings />

        {/* 정기 지출 섹션 */}
        <RecurringExpenseSettings />

        {/* 테마 섹션 */}
        <ThemeSettings />

        {/* 알림 설정 섹션 - iOS에서만 표시 */}
        {isIOSDevice && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <NotificationSettings />
          </div>
        )}

      </div>
    </div>
  );
}
