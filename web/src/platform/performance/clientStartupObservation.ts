import {
  isAndroidHostAvailable,
  requestAndroidHost,
} from '@/platform/android-host/androidHostBridge';
import { Platform } from '@/lib/utils/platform';

export type ClientStartupPlatform = 'android' | 'ios-pwa';

export interface ClientStartupObservation {
  readonly platform: ClientStartupPlatform;
  readonly durationMs: number;
}

const MAX_STARTUP_DURATION_MS = 2 * 60 * 1_000;

let capturedObservation:
  | Promise<ClientStartupObservation | undefined>
  | undefined;

function normalizedDuration(value: unknown): number | undefined {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > MAX_STARTUP_DURATION_MS
  ) {
    return undefined;
  }
  return Math.round(value * 1_000) / 1_000;
}

/**
 * 첫 화면의 모든 데이터가 실제로 그려진 순간 한 번 호출합니다.
 *
 * Android는 Activity 생성 전후의 Native WebView 준비 시간까지 포함해야 하므로
 * Native의 단조 시계 값을 사용합니다. iPhone 홈 화면 PWA는 Navigation Timing과
 * 같은 시점에서 시작하는 performance.now()를 사용합니다.
 */
export function captureClientStartupObservation():
Promise<ClientStartupObservation | undefined> {
  if (capturedObservation !== undefined) return capturedObservation;

  if (isAndroidHostAvailable()) {
    capturedObservation = requestAndroidHost(
      'performance.get-app-launch-duration',
      {}
    )
      .then(({ durationMs }) => {
        const normalized = normalizedDuration(durationMs);
        return normalized === undefined
          ? undefined
          : { platform: 'android' as const, durationMs: normalized };
      })
      .catch(() => undefined);
    return capturedObservation;
  }

  if (Platform.isIOSPWA()) {
    const normalized = normalizedDuration(window.performance?.now());
    capturedObservation = Promise.resolve(
      normalized === undefined
        ? undefined
        : { platform: 'ios-pwa' as const, durationMs: normalized }
    );
    return capturedObservation;
  }

  capturedObservation = Promise.resolve(undefined);
  return capturedObservation;
}

export function readCapturedClientStartupObservation():
Promise<ClientStartupObservation | undefined> {
  return capturedObservation ?? Promise.resolve(undefined);
}
