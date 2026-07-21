import type { MobileNotificationEndpoint } from "../../../domain/model/mobileNotificationEndpoint";

export interface MobileEndpointRegistrationTransaction {
  read(): Promise<MobileNotificationEndpoint | null>;
  save(endpoint: MobileNotificationEndpoint): Promise<void>;
  remove(): Promise<void>;
}

export interface MobileEndpointRegistrationStore {
  runForEndpoint<T>(
    endpointId: string,
    operation: (
      transaction: MobileEndpointRegistrationTransaction,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface MobileEndpointIdentityPort {
  endpointIdFor(fid: string): string;
}

export interface MobileEndpointClock {
  now(): string;
}
