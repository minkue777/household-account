import type { MessagePayload, Unsubscribe } from 'firebase/messaging';
import { Platform } from './utils/platform';
import {
  activatePwaFidEndpoint,
  isPwaPushEligible,
  notificationPermission,
  requestAndActivatePwaFidEndpoint,
  setupPwaForegroundMessageListener,
} from '@/platform/pwa/fidEndpointLifecycle';

export async function requestNotificationPermission(): Promise<boolean> {
  return requestAndActivatePwaFidEndpoint();
}

/** 이미 허용된 iOS 홈 화면 PWA endpoint를 FID 방식으로 재확인합니다. */
export async function refreshFcmToken(): Promise<void> {
  await activatePwaFidEndpoint();
}

export async function setupForegroundMessageListener(
  onMessageReceived: (payload: MessagePayload) => void
): Promise<Unsubscribe> {
  return setupPwaForegroundMessageListener(onMessageReceived);
}

export function isPushNotificationSupported(): boolean {
  return isPwaPushEligible();
}

export function getNotificationPermissionStatus(): NotificationPermission | null {
  return notificationPermission();
}

export function isIOSPWA(): boolean {
  return Platform.isIOSPWA();
}

export function isIOS(): boolean {
  return Platform.isIOS();
}
