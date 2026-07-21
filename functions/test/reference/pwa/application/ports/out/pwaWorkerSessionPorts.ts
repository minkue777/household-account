import type { PwaRootRegistration } from "../../../domain/model/pwaRootRuntime";

export interface PwaRootWorkerIdentityPort {
  currentRootRegistration(): PwaRootRegistration;
}
