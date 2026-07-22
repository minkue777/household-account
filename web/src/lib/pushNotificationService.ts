import type { MessagePayload, Unsubscribe } from 'firebase/messaging';
import { Platform } from './utils/platform';
import {
  activatePwaFidEndpoint,
  getPwaFidEndpointRegistrationState,
  isPwaPushEligible,
  notificationPermission,
  requestAndActivatePwaFidEndpoint,
  setupPwaForegroundMessageListener,
  subscribePwaFidEndpointRegistrationState,
  type PwaFidEndpointRegistrationState,
} from '@/platform/pwa/fidEndpointLifecycle';

export type { PwaFidEndpointRegistrationState };

export async function requestNotificationPermission(): Promise<boolean> {
  return requestAndActivatePwaFidEndpoint();
}

/** 이미 허용된 iOS 홈 화면 PWA endpoint를 FID 방식으로 재확인합니다. */
export async function refreshFcmToken(): Promise<boolean> {
  return activatePwaFidEndpoint();
}

export function getFidEndpointRegistrationState(): PwaFidEndpointRegistrationState {
  return getPwaFidEndpointRegistrationState();
}

export function subscribeFidEndpointRegistrationState(
  listener: (state: PwaFidEndpointRegistrationState) => void
): Unsubscribe {
  return subscribePwaFidEndpointRegistrationState(listener);
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
