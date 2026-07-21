export type MobileRuntime =
  | "android-app"
  | "ios-home-screen-pwa"
  | "ios-browser"
  | "desktop-web";

export type MobilePlatform = "android" | "ios-pwa";

export interface MobileEndpointDeviceInfo {
  model?: string;
  osVersion?: string;
  sdkVersion?: string;
  appVersion?: string;
}

export interface MobileEndpointBinding {
  householdId: string;
  memberId: string;
}

export interface MobileNotificationEndpoint {
  endpointId: string;
  fid: string;
  householdId: string;
  memberId: string;
  platform: MobilePlatform;
  status: "active" | "inactive";
  registrationVersion: number;
  bindingVersion: number;
  deviceInfo: MobileEndpointDeviceInfo;
  registeredAt: string;
  lastConfirmedAt: string;
  inactiveAt?: string;
  expiresAt?: string;
}
