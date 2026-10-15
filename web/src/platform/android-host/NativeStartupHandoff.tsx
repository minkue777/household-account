'use client';

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { isAndroidHostAvailable, requestAndroidHost } from './androidHostBridge';

const StartupHandoffCheck = createContext<() => void>(() => {});

/** 첫 실제 화면이 commit될 때만 Native 시작 화면을 내립니다. */
export function NativeStartupHandoff({ children }: { children: React.ReactNode }) {
  const mounted = useRef(false);
  const sent = useRef(false);
  const frame = useRef<number | null>(null);

  const scheduleCheck = useCallback(() => {
    if (!mounted.current || sent.current || window.__HOUSEHOLD_NATIVE_STARTUP__ !== true || !isAndroidHostAvailable()) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!mounted.current || sent.current || document.querySelector('[data-startup-screen]')) return;
      sent.current = true;
      void requestAndroidHost('startup.content-ready', {}).catch(() => {
        // Web 화면은 그대로 사용하며 Native가 문서 오류·전환 실패를 처리합니다.
      });
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    scheduleCheck();
    return () => {
      mounted.current = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [scheduleCheck]);

  return <StartupHandoffCheck.Provider value={scheduleCheck}>{children}</StartupHandoffCheck.Provider>;
}

export function useNativeStartupLoading() {
  const scheduleCheck = useContext(StartupHandoffCheck);
  useEffect(() => () => scheduleCheck(), [scheduleCheck]);
}
