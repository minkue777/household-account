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

        {/* 안내 문구 */}
        <div className="p-4 bg-slate-100 rounded-xl">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-slate-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-slate-600">
              <p className="font-medium mb-1">설정 안내</p>
              <ul className="space-y-1 text-slate-500">
                <li>카테고리를 드래그하여 순서를 변경할 수 있습니다.</li>
                <li>기본 카테고리는 삭제할 수 없습니다.</li>
                <li>가맹점 규칙은 지출 상세에서 자동 추가됩니다.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
