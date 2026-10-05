import { Platform } from './utils/platform';
export {
  activatePwaFidEndpoint as refreshFcmToken,
  getPwaFidEndpointRegistrationState as getFidEndpointRegistrationState,
  isPwaPushEligible as isPushNotificationSupported,
  notificationPermission as getNotificationPermissionStatus,
  requestAndActivatePwaFidEndpoint as requestNotificationPermission,
  setupPwaForegroundMessageListener as setupForegroundMessageListener,
  subscribePwaFidEndpointRegistrationState as subscribeFidEndpointRegistrationState,
  type PwaFidEndpointRegistrationState,
} from '@/platform/pwa/fidEndpointLifecycle';

export function isIOSPWA(): boolean {
  return Platform.isIOSPWA();
}

export function isIOS(): boolean {
  return Platform.isIOS();
}
