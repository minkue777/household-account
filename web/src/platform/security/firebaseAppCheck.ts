'use client';

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

import { app } from '@/lib/firebaseApp';

let initialized: AppCheck | undefined;

/** Callable 요청의 App Check token 공급자를 브라우저에서 한 번만 설치합니다. */
export function initializeFirebaseAppCheck(): AppCheck | undefined {
  if (typeof window === 'undefined') return undefined;
  if (initialized !== undefined) return initialized;

  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY?.trim();
  if (siteKey === undefined || siteKey === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FIREBASE_APP_CHECK_SITE_KEY_REQUIRED');
    }
    return undefined;
  }

  initialized = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return initialized;
}
