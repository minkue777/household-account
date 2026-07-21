'use client';

import { useEffect, useState } from 'react';
import { Edit2 } from 'lucide-react';
import { AndroidBridge } from '@/lib/bridges/androidBridge';

interface QuickEditOverlaySettingsProps {
  householdId?: string | null;
  memberId?: string | null;
  memberName?: string | null;
}

export default function QuickEditOverlaySettings({
  householdId,
  memberId,
  memberName,
}: QuickEditOverlaySettingsProps) {
  const [isAndroidApp, setIsAndroidApp] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    setIsAndroidApp(AndroidBridge.isAvailable());
  }, []);

  useEffect(() => {
    if (!isAndroidApp || !householdId || !memberId) {
      return;
    }
    let active = true;
    void AndroidBridge.isQuickEditOverlayEnabled(householdId, memberId)
      .then((enabled) => {
        if (active) setIsEnabled(enabled);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [householdId, isAndroidApp, memberId]);

  if (!isAndroidApp || !householdId || !memberId) {
    return null;
  }

  const handleToggle = () => {
    const nextEnabled = !isEnabled;
    setIsEnabled(nextEnabled);
    void AndroidBridge.setQuickEditOverlayEnabled(householdId, memberId, nextEnabled)
      .catch(() => setIsEnabled(!nextEnabled));
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
            <Edit2 className="h-5 w-5 text-slate-600" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-800">결제 후 바로 편집</div>
            <div className="text-sm text-slate-500">결제 알림 후 편집창 자동 열기</div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isEnabled}
          aria-label={`${memberName || '본인'} 결제 후 바로 편집`}
          onClick={handleToggle}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            isEnabled ? 'bg-blue-500' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              isEnabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
