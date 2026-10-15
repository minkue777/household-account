'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { readStartupDisplayMode } from '@/features/access-household/application/startupDisplayMode';

const StartupDisplayReady = createContext(true);
export const STARTUP_MINIMUM_DISPLAY_MS = 2_000;
const subscribe = () => () => {};
const serverDisplayMode = () => 'pending' as const;

// 관리자 선택은 새 문서에서 적용됩니다. hydration 전에는 HTML 스크립트가 같은 정책을 적용합니다.
export const useStartupDisplayMode = () => useSyncExternalStore(subscribe, readStartupDisplayMode, serverDisplayMode);

/** 문서 시작에 한 번만 기다리며 인증·홈 데이터 조회는 동시에 진행합니다. */
export function StartupDisplayProvider({ children }: { children: React.ReactNode }) {
  const mode = useStartupDisplayMode();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (mode === 'admin') return;
    const timer = window.setTimeout(() => setReady(true), STARTUP_MINIMUM_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [mode]);
  return <StartupDisplayReady.Provider value={mode === 'admin' || ready}>{children}</StartupDisplayReady.Provider>;
}

export const useStartupDisplayReady = () => useContext(StartupDisplayReady);
