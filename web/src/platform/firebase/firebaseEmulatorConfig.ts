const PRODUCTION_PROJECT_ID = 'household-account-6f300';
const DEMO_PROJECT_PREFIX = 'demo-';
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

const emulatorSuiteRequested =
  process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE === 'true';
const configuredProjectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? '';

if (
  emulatorSuiteRequested
  && (
    !configuredProjectId.startsWith(DEMO_PROJECT_PREFIX)
    || configuredProjectId.length <= DEMO_PROJECT_PREFIX.length
  )
) {
  throw new Error(
    'Firebase Emulator Suite는 demo- 접두사의 전용 프로젝트 ID에서만 사용할 수 있습니다.'
  );
}

export const firebaseRuntimeProjectId = emulatorSuiteRequested
  ? configuredProjectId
  : PRODUCTION_PROJECT_ID;

export const firebaseEmulatorHosts = Object.freeze({
  auth: { host: '127.0.0.1', port: 9099 },
  firestore: { host: '127.0.0.1', port: 8080 },
  functions: { host: '127.0.0.1', port: 5001 },
});

export function isFirebaseEmulatorSuiteConfigured(): boolean {
  return emulatorSuiteRequested;
}

function isLoopbackBrowser(): boolean {
  return typeof window !== 'undefined'
    && LOOPBACK_HOSTNAMES.has(window.location.hostname);
}

/**
 * Emulator 연결은 demo 프로젝트와 loopback에서 실행되는 브라우저에만 허용합니다.
 * 빌드 환경 변수가 실수로 배포 환경에 남더라도 원격 호스트에는 테스트 경로를 열지 않습니다.
 */
export function shouldConnectFirebaseEmulators(): boolean {
  return emulatorSuiteRequested && isLoopbackBrowser();
}

/**
 * E2E 로그인도 실제 Auth Emulator의 email/password 인증을 사용합니다.
 * 애플리케이션 인증을 우회하는 세션 주입 경로는 제공하지 않습니다.
 */
export function isFirebaseEmulatorTestLoginEnabled(): boolean {
  return shouldConnectFirebaseEmulators()
    && process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true';
}

