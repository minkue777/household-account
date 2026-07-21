import type {
  AsyncSessionResult,
  IncompatibleWriteOutcome,
  PwaClientSnapshot,
  PwaSessionTransitionInput,
  PwaWorkerRuntimeState,
  SessionPurgeOutcome,
  SessionReadAttempt,
  WorkerUpdateOutcome,
} from "../../../domain/model/pwaWorkerSession";

export type {
  AsyncSessionResult,
  IncompatibleWriteOutcome,
  PwaClientSnapshot,
  PwaSessionTransitionInput,
  PwaWorkerRuntimeState,
  SessionPurgeOutcome,
  SessionReadAttempt,
  WorkerUpdateOutcome,
};

export interface PwaWorkerSessionInputPort {
  discoverWorker(input: {
    readonly workerVersion: string;
    readonly cacheVersion: string;
    readonly requiredAssetsPrepared: boolean;
    readonly candidateCacheNamespace?: string;
  }): Promise<WorkerUpdateOutcome>;
  requestRefresh(
    clientId: string,
    expectedWaitingWorkerVersion: string,
  ): Promise<WorkerUpdateOutcome>;
  elapseWithoutUserAction(durationMs: number): WorkerUpdateOutcome;
  updateClientInput(clientId: string, unsavedInput: string): void;
  closeClient(clientId: string): Promise<WorkerUpdateOutcome>;
  reopenClient(clientId: string): void;
  beginAsyncRead(clientId: string): {
    readonly callbackId: string;
    readonly sessionGeneration: string;
  };
  subscribe(clientId: string): {
    readonly subscriptionId: string;
    readonly sessionGeneration: string;
  };
  transitionSession(
    input: PwaSessionTransitionInput,
  ): Promise<SessionPurgeOutcome>;
  attemptSessionRead(): SessionReadAttempt;
  completeAsyncRead(input: {
    readonly callbackId: string;
    readonly capturedGeneration: string;
    readonly marker: string;
  }): AsyncSessionResult;
  handleIncompatibleWrite(clientId: string): IncompatibleWriteOutcome;
  state(): PwaWorkerRuntimeState;
}
