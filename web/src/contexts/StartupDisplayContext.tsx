'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const StartupDisplayReady = createContext(true);
export const STARTUP_MINIMUM_DISPLAY_MS = 2_000;

/** 문서 시작에 한 번만 기다리며 인증·홈 데이터 조회는 동시에 진행합니다. */
export function StartupDisplayProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), STARTUP_MINIMUM_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return <StartupDisplayReady.Provider value={ready}>{children}</StartupDisplayReady.Provider>;
}

export const useStartupDisplayReady = () => useContext(StartupDisplayReady);
