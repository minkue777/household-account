import type {
  PwaClickResult,
  PwaLogoutResult,
  PwaPageResult,
  PwaPublicAssetResult,
  PwaPushResult,
  PwaRootRegistration,
  PwaRootRuntimeState,
  PwaRootWorkerCapability,
  PwaRuntimeInitializationInput,
  PwaRuntimeInitializationResult,
} from "../../../domain/model/pwaRootRuntime";

export type {
  PwaClickResult,
  PwaLogoutResult,
  PwaPageResult,
  PwaPublicAssetResult,
  PwaPushResult,
  PwaRootRegistration,
  PwaRootRuntimeState,
  PwaRootWorkerCapability,
  PwaRuntimeInitializationInput,
  PwaRuntimeInitializationResult,
};

export interface PwaRootRuntimeInputPort {
  initialize(
    input: PwaRuntimeInitializationInput,
  ): Promise<PwaRuntimeInitializationResult>;
  requestPage(path: string): PwaPageResult;
  fetchPublicAsset(path: string): PwaPublicAssetResult;
  receiveBackgroundPush(notificationId: string): PwaPushResult;
  clickNotification(
    destination: string,
    existingClient: boolean,
  ): PwaClickResult;
  logout(): Promise<PwaLogoutResult>;
  state(): PwaRootRuntimeState;
}
