import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';
import { Platform } from './utils/platform';
import { DeviceOwnerStorage } from './storage/deviceOwnerStorage';

// VAPID 키 (Firebase Console > 프로젝트 설정 > 클라우드 메시징 > 웹 푸시 인증서에서 생성)
const VAPID_KEY = 'BLI2AoMlLXi5yMOfCAPdup52iEoPoItcWzFQws-Vb5xviQ9VA1ex7oTLZ9M5kqDccQoYAiMaNSUQZSjURD98y3k';

let messaging: Messaging | null = null;

/**
 * FCM 메시징 초기화
 */
export function initializeMessaging(): Messaging | null {
  if (Platform.isServer()) return null;

  // iOS PWA에서만 동작
  if (Platform.isIOS() && !Platform.isIOSPWA()) {
    return null;
  }

  try {
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    return null;
  }
}

/**
 * 푸시 알림 권한 요청 및 토큰 등록
 */
export async function requestNotificationPermission(): Promise<string | null> {
  if (Platform.isServer()) return null;

  // 모바일에서만 FCM 토큰 등록 (PC 제외)
  if (!Platform.isMobile()) {
    return null;
  }

  // 알림 지원 확인
  if (!Platform.supportsNotification()) {
    return null;
  }

  // 권한 요청
  const permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    return null;
  }

  // 서비스 워커 등록
  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch (error) {
    return null;
  }

  // FCM 토큰 가져오기
  if (!messaging) {
    messaging = initializeMessaging();
  }

  if (!messaging) {
    return null;
  }

  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready,
    });

    if (token) {
      await saveTokenToServer(token);
      return token;
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * 토큰을 서버에 저장
 */
async function saveTokenToServer(token: string): Promise<void> {
  try {
    const functions = getFunctions(app, 'asia-northeast3');
    const saveFcmToken = httpsCallable(functions, 'saveFcmToken');

    // localStorage에서 householdKey 가져오기
    const householdKey = localStorage.getItem('householdKey') || '';

    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
    };

    const deviceOwner = DeviceOwnerStorage.get();

    await saveFcmToken({ token, deviceInfo, householdId: householdKey, deviceOwner });
  } catch (error) {
    throw error;
  }
}

/**
 * FCM 토큰 재등록 (deviceOwner 변경 시 호출)
 */
export async function refreshFcmToken(): Promise<void> {
  if (Platform.isServer()) return;

  if (!messaging) {
    messaging = initializeMessaging();
  }

  if (!messaging) return;

  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready,
    });

    if (token) {
      await saveTokenToServer(token);
    }
  } catch (error) {
    // 무시
  }
}

/**
 * 포그라운드 메시지 리스너 설정
 */
export function setupForegroundMessageListener(
  onMessageReceived: (payload: any) => void
): () => void {
  if (!messaging) {
    messaging = initializeMessaging();
  }

  if (!messaging) {
    return () => {};
  }

  return onMessage(messaging, (payload) => {
    onMessageReceived(payload);
  });
}

/**
 * 푸시 알림 지원 여부 확인
 */
export function isPushNotificationSupported(): boolean {
  return Platform.supportsPushNotification();
}

/**
 * 현재 알림 권한 상태 확인
 */
export function getNotificationPermissionStatus(): NotificationPermission | null {
  if (Platform.isServer() || !Platform.supportsNotification()) {
    return null;
  }
  return Notification.permission;
}

/**
 * iOS PWA 여부 확인
 */
export function isIOSPWA(): boolean {
  return Platform.isIOSPWA();
}

/**
 * iOS인지 확인
 */
export function isIOS(): boolean {
  return Platform.isIOS();
}

/**
 * FCM 등록 디버그 (각 단계별 결과 반환)
 */
export async function debugFcmRegistration(): Promise<string[]> {
  const logs: string[] = [];

  logs.push(`isServer: ${Platform.isServer()}`);
  logs.push(`isMobile: ${Platform.isMobile()}`);
  logs.push(`isIOS: ${Platform.isIOS()}`);
  logs.push(`isIOSPWA: ${Platform.isIOSPWA()}`);
  logs.push(`supportsNotification: ${Platform.supportsNotification()}`);
  logs.push(`permission: ${typeof Notification !== 'undefined' ? Notification.permission : 'N/A'}`);

  // 서비스 워커
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    logs.push(`SW 등록: OK (state=${reg.active?.state || reg.waiting?.state || reg.installing?.state || 'none'})`);
  } catch (e: unknown) {
    logs.push(`SW 등록: FAIL (${e instanceof Error ? e.message : e})`);
    return logs;
  }

  // 메시징 초기화
  try {
    const msg = initializeMessaging();
    logs.push(`messaging 초기화: ${msg ? 'OK' : 'FAIL (null)'}`);
    if (!msg) return logs;
  } catch (e: unknown) {
    logs.push(`messaging 초기화: FAIL (${e instanceof Error ? e.message : e})`);
    return logs;
  }

  // 토큰 발급
  try {
    const swReg = await navigator.serviceWorker.ready;
    logs.push(`SW ready: OK`);
    const token = await getToken(messaging!, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    logs.push(`getToken: ${token ? token.substring(0, 20) + '...' : 'null'}`);

    if (token) {
      try {
        await saveTokenToServer(token);
        logs.push(`saveToken: OK`);
      } catch (e: unknown) {
        logs.push(`saveToken: FAIL (${e instanceof Error ? e.message : e})`);
      }
    }
  } catch (e: unknown) {
    logs.push(`getToken: FAIL (${e instanceof Error ? e.message : e})`);
  }

  return logs;
}
