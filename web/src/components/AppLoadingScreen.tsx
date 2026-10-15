'use client';

import Image from 'next/image';
import { useSyncExternalStore } from 'react';
import brandIcon from '@/assets/startup-illustration.webp';
import { useHousehold } from '@/contexts/HouseholdContext';
import { subscribeSignedInMembershipCache } from '@/features/access-household/application/signedInMembershipCache';
import { readStartupHouseholdName, STARTUP_HOUSEHOLD_NAME_SCRIPT } from '@/features/access-household/application/startupHouseholdName';
import { useNativeStartupLoading } from '@/platform/android-host/NativeStartupHandoff';
import { useStartupDisplayMode } from '@/contexts/StartupDisplayContext';

export default function AppLoadingScreen() {
  useNativeStartupLoading();
  const displayMode = useStartupDisplayMode();
  const { household, sessionState } = useHousehold();
  const lastHouseholdName = useSyncExternalStore(subscribeSignedInMembershipCache, readStartupHouseholdName, readStartupHouseholdName);
  const householdName = household?.name ?? (sessionState === 'resolving' ? lastHouseholdName : '');
  const title = householdName || '모두의 가계부';

  return (
    <div role="status" aria-busy="true" data-startup-screen data-startup-mode={displayMode} suppressHydrationWarning className="fixed inset-x-0 top-0 flex h-[100dvh] items-center justify-center bg-[#f5f2fd] p-6">
      <div className="startup-brand flex max-w-full flex-col items-center text-center">
        <h1 className="startup-title order-2 max-w-full break-words text-[#36578b]">
          <span suppressHydrationWarning>{title.endsWith('네') ? title.slice(0, -1) : title}</span>
          <span suppressHydrationWarning className="text-[#9755e9]">{title.endsWith('네') ? '네' : ''}</span>
        </h1>
        {/* Fill the name before the parser can expose a cached image. Client updates use the store above. */}
        <script suppressHydrationWarning data-startup-household-name dangerouslySetInnerHTML={{ __html: STARTUP_HOUSEHOLD_NAME_SCRIPT }} />
        <Image
          src={brandIcon}
          alt=""
          width={198}
          height={198}
          priority
          unoptimized
          className="startup-illustration order-1 h-auto max-w-full object-contain"
        />
        <p className="startup-subtitle order-3 text-[#52698f]">가계부 · 자산</p>
      </div>
      <div aria-hidden="true" className="startup-dots absolute flex gap-2">
        <span className="h-[7px] w-[7px] rounded-full bg-[#9755e9]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#4c90ee]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#d7c7f4]" />
      </div>
      <span aria-hidden="true" className="startup-admin-status text-gray-500">로딩중...</span>
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
