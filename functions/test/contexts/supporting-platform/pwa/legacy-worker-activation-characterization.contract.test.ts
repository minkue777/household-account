import { describe, expect, it } from "vitest";

export interface LegacyWorkerActivationState {
  activeWorkerVersion: string;
  waitingWorkerVersion?: string;
  openClientReloadCount: number;
  unsavedFormValue: string;
}

export interface LegacyWorkerActivationCharacterizationContractSubject {
  installCurrentArtifact(input: {
    workerVersion: string;
    openClientUnsavedForm: string;
  }): Promise<void>;
  state(): LegacyWorkerActivationState;
}

export function createSubject(
  fixture: { activeWorkerVersion: string },
): LegacyWorkerActivationCharacterizationContractSubject {
  void fixture;
  throw new Error(
    "LegacyWorkerActivationCharacterizationContractSubject 구현 연결이 필요합니다.",
  );
}

describe.skip("교체 전 PWA skipWaiting 동작 특성화", () => {
  it("[T-PWA-LEGACY-ACTIVATION-001][PWA-002] 기존 artifact는 열린 화면의 입력 여부를 확인하지 않고 새 worker를 즉시 활성화한다", async () => {
    const subject = createSubject({ activeWorkerVersion: "worker-v1" });

    await subject.installCurrentArtifact({
      workerVersion: "worker-v2",
      openClientUnsavedForm: "저장하지 않은 값",
    });

    expect(subject.state()).toEqual({
      activeWorkerVersion: "worker-v2",
      waitingWorkerVersion: undefined,
      openClientReloadCount: 0,
      unsavedFormValue: "저장하지 않은 값",
    });
  });
});
