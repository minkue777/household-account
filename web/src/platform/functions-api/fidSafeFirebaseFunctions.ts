import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from 'firebase/functions';

import { app } from '@/lib/firebaseApp';
import {
  firebaseEmulatorHosts,
  shouldConnectFirebaseEmulators,
} from '@/platform/firebase/firebaseEmulatorConfig';

const REGION = 'asia-northeast3';

interface FunctionsContextProvider {
  messaging?: unknown;
}

type FunctionsWithContextProvider = Functions & {
  contextProvider?: FunctionsContextProvider;
};

/**
 * Firebase JS SDK 12.15+의 httpsCallable이 FID 등록 뒤 구형 등록 토큰 API를
 * 호출해 FID target을 무효화하는 문제에 대한 임시 우회입니다.
 *
 * Upstream: https://github.com/firebase/firebase-js-sdk/issues/10135
 * Firebase에서 공식 수정이 배포되고 회귀 검증이 끝나면 제거합니다.
 */
export function getFidSafeFirebaseFunctions(): Functions {
  const functions = getFunctions(app, REGION) as FunctionsWithContextProvider;
  if (shouldConnectFirebaseEmulators()) {
    const runtime = globalThis as typeof globalThis & {
      __householdAccountFirebaseEmulators?: { functions?: boolean };
    };
    runtime.__householdAccountFirebaseEmulators ??= {};
    if (!runtime.__householdAccountFirebaseEmulators.functions) {
      connectFunctionsEmulator(
        functions,
        firebaseEmulatorHosts.functions.host,
        firebaseEmulatorHosts.functions.port
      );
      runtime.__householdAccountFirebaseEmulators.functions = true;
    }
  }
  const contextProvider = functions.contextProvider;

  if (contextProvider) {
    contextProvider.messaging = undefined;
  }

  return functions;
}
