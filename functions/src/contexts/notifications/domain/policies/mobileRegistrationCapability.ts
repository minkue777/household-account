import type {
  MobilePlatform,
  MobileRuntime,
} from "../model/mobileNotificationEndpoint";

export type MobileRegistrationCapability =
  | { kind: "eligible"; platform: MobilePlatform }
  | {
      kind: "not-eligible";
      reason:
        | "IOS_HOME_SCREEN_INSTALL_REQUIRED"
        | "IOS_NOTIFICATION_PERMISSION_REQUIRED"
        | "DESKTOP_NOT_SUPPORTED";
    };

export function evaluateMobileRegistrationCapability(input: {
  runtime: MobileRuntime;
  osNotificationPermission: "granted" | "denied";
}): MobileRegistrationCapability {
  if (input.runtime === "android-app") {
    return { kind: "eligible", platform: "android" };
  }
  if (input.runtime === "ios-home-screen-pwa") {
    return input.osNotificationPermission === "granted"
      ? { kind: "eligible", platform: "ios-pwa" }
      : {
          kind: "not-eligible",
          reason: "IOS_NOTIFICATION_PERMISSION_REQUIRED",
        };
  }
  if (input.runtime === "ios-browser") {
    return {
      kind: "not-eligible",
      reason: "IOS_HOME_SCREEN_INSTALL_REQUIRED",
    };
  }
  return { kind: "not-eligible", reason: "DESKTOP_NOT_SUPPORTED" };
}
