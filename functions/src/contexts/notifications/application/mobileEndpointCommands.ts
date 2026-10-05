import type { MobileEndpointBinding, MobileEndpointDeviceInfo, MobilePlatform } from '../domain/model/mobileNotificationEndpoint';
import type { MobileEndpointClock, MobileEndpointIdentityPort, MobileEndpointRegistrationStore } from './ports/outbound/mobileEndpointRegistrationStore';
import { decideEndpointInactivation } from '../domain/policies/endpointInactivationPolicy';
import { decideEndpointRegistration } from '../domain/policies/endpointRegistrationPolicy';

type EndpointResult =
  | { kind: 'registered'; endpointId: string; registrationVersion: number; result: 'created' | 'refreshed' | 'stale-binding-recovered' }
  | { kind: 'removed' | 'inactivated' | 'stale-ignored'; endpointId: string }
  | { kind: 'already-absent' }
  | { kind: 'validation-error'; code: 'FID_REQUIRED' };

/** Each command uses the verified binding supplied by its authenticated request. */
export function createMobileEndpointCommands(
  store: MobileEndpointRegistrationStore,
  identity: MobileEndpointIdentityPort,
  clock: MobileEndpointClock,
  binding: MobileEndpointBinding,
) {
  const owns = (endpoint: MobileEndpointBinding) => endpoint.householdId === binding.householdId && endpoint.memberId === binding.memberId;
  return {
    async register(input: { fid: string; platform: MobilePlatform; deviceInfo: MobileEndpointDeviceInfo }): Promise<EndpointResult> {
      const fid = input.fid.trim();
      if (!fid) return { kind: 'validation-error', code: 'FID_REQUIRED' };
      const endpointId = identity.endpointIdFor(fid);
      return store.runForEndpoint(endpointId, async transaction => {
        const current = await transaction.read();
        const decision = decideEndpointRegistration(current, {
          endpointId, fid, binding, platform: input.platform, deviceInfo: input.deviceInfo, confirmedAt: clock.now(),
        });
        await transaction.save(decision.endpoint);
        return { kind: 'registered', endpointId, registrationVersion: decision.endpoint.registrationVersion, result: decision.result };
      });
    },
    async unregister(input: { fid: string; expectedRegistrationVersion: number }): Promise<EndpointResult> {
      const fid = input.fid.trim();
      if (!fid) return { kind: 'validation-error', code: 'FID_REQUIRED' };
      const endpointId = identity.endpointIdFor(fid);
      return store.runForEndpoint(endpointId, async transaction => {
        const current = await transaction.read();
        if (!current) return { kind: 'already-absent' };
        if (!owns(current) || current.registrationVersion !== input.expectedRegistrationVersion) return { kind: 'stale-ignored', endpointId };
        const decision = decideEndpointInactivation({ current, expectedRegistrationVersion: input.expectedRegistrationVersion,
          expectedBindingVersion: current.bindingVersion, now: clock.now(), observation: { source: 'sdk-unregistered' } });
        if (decision.kind !== 'Inactivated') return { kind: 'stale-ignored', endpointId };
        await transaction.save(decision.endpoint);
        return { kind: 'inactivated', endpointId };
      });
    },
    async logout(rawFid: string): Promise<EndpointResult> {
      const fid = rawFid.trim();
      if (!fid) return { kind: 'validation-error', code: 'FID_REQUIRED' };
      const endpointId = identity.endpointIdFor(fid);
      return store.runForEndpoint(endpointId, async transaction => {
        const current = await transaction.read();
        if (!current) return { kind: 'already-absent' };
        if (!owns(current)) return { kind: 'stale-ignored', endpointId };
        await transaction.remove();
        return { kind: 'removed', endpointId };
      });
    },
  };
}
