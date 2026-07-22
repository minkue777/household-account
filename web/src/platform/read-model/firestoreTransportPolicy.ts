export interface FirestoreRuntimeEnvironment {
  readonly androidHostBridgeAvailable: boolean;
  readonly userAgent: string;
}

export interface FirestoreTransportSettings {
  readonly experimentalForceLongPolling?: boolean;
}

function isAndroidWebViewUserAgent(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent) && (
    /;\s*wv\)/i.test(userAgent) ||
    /\bVersion\/4\.0\b/i.test(userAgent)
  );
}

/**
 * Android WebView에서는 Firestore WebChannel 응답이 중간 계층에서 계속 열린 채
 * 대기할 수 있으므로 자동 감지 대신 long-polling을 명시적으로 사용합니다.
 */
export function firestoreTransportSettings(
  environment: FirestoreRuntimeEnvironment
): FirestoreTransportSettings {
  if (
    environment.androidHostBridgeAvailable ||
    isAndroidWebViewUserAgent(environment.userAgent)
  ) {
    return { experimentalForceLongPolling: true };
  }
  return {};
}

export function currentFirestoreRuntimeEnvironment(): FirestoreRuntimeEnvironment {
  if (typeof window === 'undefined') {
    return { androidHostBridgeAvailable: false, userAgent: '' };
  }

  const globalScope = window as typeof window & {
    HouseholdNativeBridge?: { postMessage?: unknown };
  };
  return {
    androidHostBridgeAvailable:
      typeof globalScope.HouseholdNativeBridge?.postMessage === 'function',
    userAgent: window.navigator.userAgent,
  };
}
