import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

// VAPID 키 (Firebase Console > 프로젝트 설정 > 클라우드 메시징 > 웹 푸시 인증서에서 생성)
const VAPID_KEY = 'BLI2AoMlLXi5yMOfCAPdup52iEoPoItcWzFQws-Vb5xviQ9VA1ex7oTLZ9M5kqDccQoYAiMaNSUQZSjURD98y3k';

let messaging: Messaging | null = null;

/**
 * FCM 메시징 초기화
 */
export function initializeMessaging(): Messaging | null {
  if (typeof window === 'undefined') return null;

  // iOS Safari 체크
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = (window.navigator as any).standalone === true;

  // iOS PWA에서만 동작
  if (isIOS && !isStandalone) {
    console.log('iOS에서는 홈 화면에 추가한 PWA에서만 푸시 알림이 지원됩니다.');
    return null;
  }

  try {
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error('FCM 초기화 실패:', error);
    return null;
  }
}

/**
 * 푸시 알림 권한 요청 및 토큰 등록
 */
export async function requestNotificationPermission(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  // 알림 지원 확인
  if (!('Notification' in window)) {
    console.log('이 브라우저는 알림을 지원하지 않습니다.');
    return null;
  }

  // 권한 요청
  const permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    console.log('알림 권한이 거부되었습니다.');
    return null;
  }

  // 서비스 워커 등록
  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('Service Worker 등록 완료:', registration);
  } catch (error) {
    console.error('Service Worker 등록 실패:', error);
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
      console.log('FCM 토큰:', token);
      await saveTokenToServer(token);
      return token;
    } else {
      console.log('FCM 토큰을 가져올 수 없습니다.');
      return null;
    }
  } catch (error) {
    console.error('FCM 토큰 가져오기 실패:', error);
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

    await saveFcmToken({ token, deviceInfo, householdId: householdKey });
    console.log('FCM 토큰 서버 저장 완료 (householdId:', householdKey, ')');
  } catch (error) {
    console.error('FCM 토큰 서버 저장 실패:', error);
    throw error;
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
    console.log('포그라운드 메시지 수신:', payload);
    onMessageReceived(payload);
  });
}

/**
 * 푸시 알림 지원 여부 확인
 */
export function isPushNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false;

  return 'Notification' in window &&
         'serviceWorker' in navigator &&
         'PushManager' in window;
}

/**
 * 현재 알림 권한 상태 확인
 */
export function getNotificationPermissionStatus(): NotificationPermission | null {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }
  return Notification.permission;
}

/**
 * iOS PWA 여부 확인
 */
export function isIOSPWA(): boolean {
  if (typeof window === 'undefined') return false;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = (window.navigator as any).standalone === true;

  return isIOS && isStandalone;
}

/**
 * iOS인지 확인
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
