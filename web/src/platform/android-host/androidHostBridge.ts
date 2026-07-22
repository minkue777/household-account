export const ANDROID_BRIDGE_CONTRACT_VERSION = 'android-bridge.v1' as const;
export const ANDROID_BRIDGE_RESPONSE_CONTRACT_VERSION = 'android-bridge-response.v1' as const;

interface AndroidBridgeRequestMap {
  'auth.sign-in': Record<string, never>;
  'auth.sign-out': Record<string, never>;
  'session.refresh': Record<string, never>;
  'app.get-version': Record<string, never>;
  'quick-edit.get-overlay-enabled': { householdId: string; memberId: string };
  'quick-edit.set-overlay-enabled': {
    householdId: string;
    memberId: string;
    enabled: boolean;
  };
}

export type AndroidSignedInUserResolution =
  | {
      kind: 'membership-found';
      membership: {
        householdId: string;
        memberId: string;
        displayName: string;
        aggregateVersion: number;
        status: 'active';
        capabilities: string[];
      };
    }
  | { kind: 'first-visit-required'; choices: Array<'create' | 'join'> };

interface AndroidBridgeResultMap {
  'auth.sign-in': {
    customToken: string;
    principalUid?: string;
    signedInUserResolution?: AndroidSignedInUserResolution;
  };
  'auth.sign-out': Record<string, never>;
  'session.refresh': { householdId: string; memberId: string; sessionGeneration: number };
  'app.get-version': { version: string | null };
  'quick-edit.get-overlay-enabled': { enabled: boolean };
  'quick-edit.set-overlay-enabled': Record<string, never>;
}

type AndroidBridgeOperation = keyof AndroidBridgeRequestMap;

interface NativeWebMessageEvent {
  data: string;
}

interface HouseholdNativeBridgeObject {
  postMessage(message: string): void;
  onmessage: ((event: NativeWebMessageEvent) => void) | null;
}

declare global {
  interface Window {
    HouseholdNativeBridge?: HouseholdNativeBridgeObject;
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();
let listeningBridge: HouseholdNativeBridgeObject | undefined;

function getBridge(): HouseholdNativeBridgeObject | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.HouseholdNativeBridge;
  return bridge && typeof bridge.postMessage === 'function' ? bridge : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function handleNativeResponse(event: NativeWebMessageEvent): void {
  let response: unknown;
  try {
    response = JSON.parse(event.data);
  } catch {
    return;
  }
  if (
    !isRecord(response) ||
    response.contractVersion !== ANDROID_BRIDGE_RESPONSE_CONTRACT_VERSION ||
    typeof response.requestId !== 'string' ||
    !isRecord(response.result)
  ) {
    return;
  }

  const pending = pendingRequests.get(response.requestId);
  if (!pending) return;
  pendingRequests.delete(response.requestId);
  clearTimeout(pending.timeoutId);

  if (response.result.kind === 'succeeded' && 'value' in response.result) {
    pending.resolve(response.result.value);
    return;
  }
  const code = isRecord(response.result.error) && typeof response.result.error.code === 'string'
    ? response.result.error.code
    : 'ANDROID_BRIDGE_REJECTED';
  pending.reject(new Error(`Android 브리지 요청이 거부되었습니다: ${code}`));
}

function ensureResponseListener(bridge: HouseholdNativeBridgeObject): void {
  if (listeningBridge === bridge) return;
  bridge.onmessage = handleNativeResponse;
  listeningBridge = bridge;
}

function nextRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `android-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isAndroidHostAvailable(): boolean {
  return getBridge() !== undefined;
}

export async function refreshAndroidHostSession(expected: {
  householdId: string;
  memberId: string;
}): Promise<void> {
  if (!isAndroidHostAvailable()) return;
  const result = await requestAndroidHost('session.refresh', {});
  if (
    result.householdId !== expected.householdId ||
    result.memberId !== expected.memberId
  ) {
    throw new Error('Android 호스트와 Web의 인증 세션 범위가 일치하지 않습니다.');
  }
}

export function requestAndroidHost<Operation extends AndroidBridgeOperation>(
  operation: Operation,
  payload: AndroidBridgeRequestMap[Operation]
): Promise<AndroidBridgeResultMap[Operation]> {
  const bridge = getBridge();
  if (!bridge) return Promise.reject(new Error('Android 호스트 브리지를 사용할 수 없습니다.'));
  ensureResponseListener(bridge);

  const requestId = nextRequestId();
  const request = JSON.stringify({
    contractVersion: ANDROID_BRIDGE_CONTRACT_VERSION,
    requestId,
    operation,
    payload,
  });
  const timeoutMs = operation === 'auth.sign-in' ? 180_000 : 5_000;

  return new Promise<AndroidBridgeResultMap[Operation]>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Android 브리지 응답 시간이 초과되었습니다.'));
    }, timeoutMs);
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as AndroidBridgeResultMap[Operation]),
      reject,
      timeoutId,
    });
    try {
      bridge.postMessage(request);
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error('Android 브리지 요청에 실패했습니다.'));
    }
  });
}
