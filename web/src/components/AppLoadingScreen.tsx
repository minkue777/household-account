'use client';

import Image from 'next/image';
import { useSyncExternalStore } from 'react';
import brandIcon from '@/assets/startup-illustration.webp';
import { useHousehold } from '@/contexts/HouseholdContext';
import { subscribeSignedInMembershipCache } from '@/features/access-household/application/signedInMembershipCache';
import { readStartupHouseholdName } from '@/features/access-household/application/startupHouseholdName';

export default function AppLoadingScreen() {
  const { household, sessionState } = useHousehold();
  const lastHouseholdName = useSyncExternalStore(subscribeSignedInMembershipCache, readStartupHouseholdName, readStartupHouseholdName);
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
        <h1 className="startup-title max-w-full break-words text-[#36578b]">
          <span suppressHydrationWarning>{householdName.endsWith('네') ? householdName.slice(0, -1) : householdName}</span>
          <span suppressHydrationWarning className="text-[#9755e9]">{householdName.endsWith('네') ? '네' : ''}</span>
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
