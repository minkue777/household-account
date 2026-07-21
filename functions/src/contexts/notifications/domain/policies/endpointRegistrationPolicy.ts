import type {
  MobileEndpointBinding,
  MobileEndpointDeviceInfo,
  MobileNotificationEndpoint,
  MobilePlatform,
} from "../model/mobileNotificationEndpoint";

export interface RegisterMobileEndpointFact {
  endpointId: string;
  fid: string;
  binding: MobileEndpointBinding;
  platform: MobilePlatform;
  deviceInfo: MobileEndpointDeviceInfo;
  confirmedAt: string;
}

export interface EndpointRegistrationDecision {
  endpoint: MobileNotificationEndpoint;
  result: "created" | "refreshed" | "stale-binding-recovered";
}

function hasSameBinding(
  endpoint: MobileNotificationEndpoint,
  binding: MobileEndpointBinding,
): boolean {
  return (
    endpoint.householdId === binding.householdId &&
    endpoint.memberId === binding.memberId
  );
}

export function decideEndpointRegistration(
  current: MobileNotificationEndpoint | null,
  registration: RegisterMobileEndpointFact,
): EndpointRegistrationDecision {
  if (current === null) {
    return {
      result: "created",
      endpoint: {
        endpointId: registration.endpointId,
        fid: registration.fid,
        householdId: registration.binding.householdId,
        memberId: registration.binding.memberId,
        platform: registration.platform,
        status: "active",
        registrationVersion: 1,
        bindingVersion: 1,
        deviceInfo: { ...registration.deviceInfo },
        registeredAt: registration.confirmedAt,
        lastConfirmedAt: registration.confirmedAt,
      },
    };
  }

  const sameBinding = hasSameBinding(current, registration.binding);
  return {
    result: sameBinding ? "refreshed" : "stale-binding-recovered",
    endpoint: {
      ...current,
      fid: registration.fid,
      householdId: registration.binding.householdId,
      memberId: registration.binding.memberId,
      platform: registration.platform,
      status: "active",
      registrationVersion: current.registrationVersion + 1,
      bindingVersion: sameBinding
        ? current.bindingVersion
        : current.bindingVersion + 1,
      deviceInfo: { ...registration.deviceInfo },
      lastConfirmedAt: registration.confirmedAt,
      inactiveAt: undefined,
      expiresAt: undefined,
    },
  };
}
