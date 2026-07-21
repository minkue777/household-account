import { describe, expect, it } from 'vitest';
import { createAssetRevaluationWorkflowFixture } from '../../support/asset-revaluation-workflow-fixture';

interface AssetView {
  assetId: string;
  currentBalance: number;
  costBasis: number;
  aggregateVersion: number;
}

interface PositionView {
  positionId: string;
  assetId: string;
  quantity: number;
  averagePrice: number;
  evaluatedPrice: number;
  evaluatedAmount: number;
  aggregateVersion: number;
}

interface RevaluationCommand {
  commandId: string;
  idempotencyKey: string;
  householdId: string;
  assetId: string;
  expectedAssetVersion: number;
  operation: 'add' | 'update' | 'delete';
  positionId: string;
  expectedPositionVersion?: number;
  quantity?: number;
  averagePrice?: number;
  evaluatedPrice?: number;
}

interface RevaluationSuccess {
  kind: 'success';
  asset: AssetView;
  position?: PositionView;
}

type RevaluationResult =
  | RevaluationSuccess
  | { kind: 'conflict'; code: 'REVALUATION_VERSION_MISMATCH' | 'IDEMPOTENCY_PAYLOAD_MISMATCH' }
  | { kind: 'retryable-failure'; code: 'UOW_RETRY_EXHAUSTED' };

type PortfolioEvent =
  | {
      eventType: 'PositionChanged.v1';
      aggregateId: string;
      aggregateVersion: number;
      assetId: string;
    }
  | {
      eventType: 'AssetValuationChanged.v1';
      aggregateId: string;
      aggregateVersion: number;
      currentSignedBalance: number;
    };

interface WorkflowFixture {
  asset: AssetView;
  positions?: readonly PositionView[];
  transactionMayRetryCallback?: boolean;
  failCommit?: boolean;
}

/** Position과 부모 Asset을 함께 변경하는 Context 공개 Workflow 계약입니다. */
export interface AssetRevaluationWorkflowSubject {
  execute(command: RevaluationCommand): Promise<RevaluationResult>;
  queryAsset(assetId: string): Promise<AssetView>;
  listPositions(assetId: string): Promise<readonly PositionView[]>;
  recordedEvents(): readonly PortfolioEvent[];
}

export function createSubject(fixture: WorkflowFixture): AssetRevaluationWorkflowSubject {
  return createAssetRevaluationWorkflowFixture(fixture);
}

const initialAsset: AssetView = {
  assetId: 'asset-1',
  currentBalance: 0,
  costBasis: 0,
  aggregateVersion: 1,
};

const addCommand = (overrides: Partial<RevaluationCommand> = {}): RevaluationCommand => ({
  commandId: 'command-1',
  idempotencyKey: 'request-1',
  householdId: 'house-1',
  assetId: 'asset-1',
  expectedAssetVersion: 1,
  operation: 'add',
  positionId: 'position-1',
  quantity: 10,
  averagePrice: 90,
  evaluatedPrice: 100,
  ...overrides,
});

describe('AssetRevaluationWorkflow 공개 계약', () => {
  it('[T-HOLD-001][HOLD-003/HOLD-004] Position·부모 Asset·공개 Event를 하나의 완결된 결과로 반영한다', async () => {
    const subject = createSubject({ asset: initialAsset });

    const result = await subject.execute(addCommand());

    expect(result).toEqual({
      kind: 'success',
      asset: {
        assetId: 'asset-1',
        currentBalance: 1_000,
        costBasis: 900,
        aggregateVersion: 2,
      },
      position: {
        positionId: 'position-1',
        assetId: 'asset-1',
        quantity: 10,
        averagePrice: 90,
        evaluatedPrice: 100,
        evaluatedAmount: 1_000,
        aggregateVersion: 1,
      },
    });
    expect(await subject.queryAsset('asset-1')).toEqual(result.kind === 'success' ? result.asset : undefined);
    expect(await subject.listPositions('asset-1')).toEqual(result.kind === 'success' ? [result.position] : []);
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: 'PositionChanged.v1',
        aggregateId: 'position-1',
        aggregateVersion: 1,
        assetId: 'asset-1',
      },
      {
        eventType: 'AssetValuationChanged.v1',
        aggregateId: 'asset-1',
        aggregateVersion: 2,
        currentSignedBalance: 1_000,
      },
    ]);
  });

  it('[T-HOLD-001][HOLD-004] transaction callback이 재실행되어도 최종 상태와 두 Event는 한 번만 반영된다', async () => {
    const subject = createSubject({ asset: initialAsset, transactionMayRetryCallback: true });

    const result = await subject.execute(addCommand());

    expect(result.kind).toBe('success');
    expect(await subject.listPositions('asset-1')).toHaveLength(1);
    expect(await subject.queryAsset('asset-1')).toEqual(
      expect.objectContaining({ currentBalance: 1_000, costBasis: 900, aggregateVersion: 2 })
    );
    expect(subject.recordedEvents().filter((event) => event.eventType === 'PositionChanged.v1')).toHaveLength(1);
    expect(subject.recordedEvents().filter((event) => event.eventType === 'AssetValuationChanged.v1')).toHaveLength(1);
  });

  it('[T-HOLD-001][HOLD-004] 부모 Asset commit 실패는 Position과 Event를 포함한 전체 결과를 이전 상태로 유지한다', async () => {
    const subject = createSubject({ asset: initialAsset, failCommit: true });

    const result = await subject.execute(addCommand());

    expect(result).toEqual({ kind: 'retryable-failure', code: 'UOW_RETRY_EXHAUSTED' });
    expect(await subject.queryAsset('asset-1')).toEqual(initialAsset);
    expect(await subject.listPositions('asset-1')).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it.each([
    addCommand({ expectedAssetVersion: 0 }),
    addCommand({ operation: 'update', expectedPositionVersion: 99 }),
  ])('[T-HOLD-001][HOLD-004] Asset 또는 Position version이 다르면 write 0건인 Conflict를 반환한다', async (command) => {
    const existingPosition: PositionView = {
      positionId: 'position-1',
      assetId: 'asset-1',
      quantity: 1,
      averagePrice: 90,
      evaluatedPrice: 100,
      evaluatedAmount: 100,
      aggregateVersion: 1,
    };
    const subject = createSubject({ asset: initialAsset, positions: [existingPosition] });

    const result = await subject.execute(command);

    expect(result).toEqual({ kind: 'conflict', code: 'REVALUATION_VERSION_MISMATCH' });
    expect(await subject.queryAsset('asset-1')).toEqual(initialAsset);
    expect(await subject.listPositions('asset-1')).toEqual([existingPosition]);
    expect(subject.recordedEvents()).toEqual([]);
  });

  it('[T-HOLD-001][HOLD-004] 같은 idempotency key와 payload 재요청은 최초 결과를 재생하고 중복 반영하지 않는다', async () => {
    const subject = createSubject({ asset: initialAsset });
    const command = addCommand();

    const first = await subject.execute(command);
    const replay = await subject.execute(command);

    expect(replay).toEqual(first);
    expect(await subject.listPositions('asset-1')).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(2);
  });

  it('[T-HOLD-001][HOLD-004] 같은 idempotency key의 다른 payload는 기존 상태를 바꾸지 않는 Conflict다', async () => {
    const subject = createSubject({ asset: initialAsset });
    await subject.execute(addCommand());
    const beforeAsset = await subject.queryAsset('asset-1');
    const beforePositions = await subject.listPositions('asset-1');
    const beforeEvents = subject.recordedEvents();

    const conflict = await subject.execute(addCommand({ quantity: 11, commandId: 'command-2' }));

    expect(conflict).toEqual({ kind: 'conflict', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(await subject.queryAsset('asset-1')).toEqual(beforeAsset);
    expect(await subject.listPositions('asset-1')).toEqual(beforePositions);
    expect(subject.recordedEvents()).toEqual(beforeEvents);
  });

  it('[T-HOLD-001][HOLD-004] 같은 version에서 동시에 추가하면 하나만 성공하고 최종 합계는 성공 Position과 일치한다', async () => {
    const subject = createSubject({ asset: initialAsset });

    const results = await Promise.all([
      subject.execute(addCommand({ commandId: 'a', idempotencyKey: 'a', positionId: 'position-a' })),
      subject.execute(addCommand({ commandId: 'b', idempotencyKey: 'b', positionId: 'position-b' })),
    ]);

    expect(results.filter((result) => result.kind === 'success')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'conflict')).toEqual([
      { kind: 'conflict', code: 'REVALUATION_VERSION_MISMATCH' },
    ]);
    expect(await subject.listPositions('asset-1')).toHaveLength(1);
    expect(await subject.queryAsset('asset-1')).toEqual(
      expect.objectContaining({ currentBalance: 1_000, costBasis: 900, aggregateVersion: 2 })
    );
  });
});
