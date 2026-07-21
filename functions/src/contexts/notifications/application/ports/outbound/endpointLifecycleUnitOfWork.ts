import type {
  RegisterEndpointResult,
  RemoveEndpointResult,
} from "../in/endpointLifecyclePort";
import type { MobileNotificationEndpoint } from "../../../domain/model/mobileNotificationEndpoint";

export type EndpointCommandReceipt =
  | {
      commandType: "register";
      idempotencyKey: string;
      payloadFingerprint: string;
      result: RegisterEndpointResult;
    }
  | {
      commandType: "remove";
      idempotencyKey: string;
      payloadFingerprint: string;
      result: RemoveEndpointResult;
    };

export interface EndpointLifecycleTransaction {
  readEndpoint(): Promise<MobileNotificationEndpoint | null>;
  saveEndpoint(endpoint: MobileNotificationEndpoint): Promise<void>;
  removeEndpoint(): Promise<void>;
  readReceipt(idempotencyKey: string): Promise<EndpointCommandReceipt | null>;
  saveReceipt(receipt: EndpointCommandReceipt): Promise<void>;
}

export interface EndpointLifecycleUnitOfWork {
  runForEndpoint<T>(
    endpointId: string,
    operation: (transaction: EndpointLifecycleTransaction) => Promise<T>,
  ): Promise<T>;
  listByHousehold(
    householdId: string,
  ): Promise<readonly MobileNotificationEndpoint[]>;
}
