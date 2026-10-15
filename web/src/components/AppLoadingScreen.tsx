'use client';

import Image from 'next/image';
import { useSyncExternalStore } from 'react';
import brandIcon from '@/assets/startup-illustration.webp';
import { useHousehold } from '@/contexts/HouseholdContext';
import { readLastVerifiedHouseholdName, subscribeSignedInMembershipCache } from '@/features/access-household/application/signedInMembershipCache';
import { readAdminHouseholdViewSelection } from '@/features/access-household/application/adminHouseholdViewSelection';

function readStartupHouseholdName(): string {
  // 관리자 조회 대상에는 본인 가구의 저장된 이름을 사용하지 않습니다.
  try {
    return readAdminHouseholdViewSelection() ? '' : readLastVerifiedHouseholdName();
  } catch {
    return '';
  }
}

export default function AppLoadingScreen() {
  const { household, sessionState } = useHousehold();
  const lastHouseholdName = useSyncExternalStore(subscribeSignedInMembershipCache, readStartupHouseholdName, () => '');
  const householdName = household?.name ?? (sessionState === 'resolving' ? lastHouseholdName : '');

  return (
    <div role="status" aria-busy="true" className="fixed inset-x-0 top-0 flex h-[100dvh] items-center justify-center bg-[#f5f2fd] p-6">
      <div className="flex max-w-full flex-col items-center text-center">
        <Image
          src={brandIcon}
          alt=""
          width={198}
          height={198}
          priority
          unoptimized
          className="startup-illustration h-auto max-w-full object-contain"
        />
        <h1 aria-label={householdName || undefined} className="startup-title max-w-full break-words text-[#36578b]">
          {householdName.endsWith('네') ? <>
            {householdName.slice(0, -1)}<span className="text-[#9755e9]">네</span>
          </> : householdName}
        </h1>
        <p className="startup-subtitle text-[#52698f]">가계부 · 자산</p>
      </div>
      <div aria-hidden="true" className="startup-dots absolute flex gap-2">
        <span className="h-[7px] w-[7px] rounded-full bg-[#9755e9]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#4c90ee]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#d7c7f4]" />
      </div>
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
