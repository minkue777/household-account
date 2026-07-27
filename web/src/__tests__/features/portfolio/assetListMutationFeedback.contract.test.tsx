import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AssetList from '@/components/assets/AssetList';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { updateAssetOrders } from '@/lib/assetService';
import type { Asset } from '@/types/asset';

jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: jest.fn(),
}));

jest.mock('@/lib/assetService', () => ({
  updateAssetOrders: jest.fn(),
}));

jest.mock('@/components/assets/AssetCard', () => ({
  __esModule: true,
  default: ({ asset }: { asset: Asset }) => <div>{asset.name}</div>,
}));

const mockedUseAppDialog = jest.mocked(useAppDialog);
const mockedUpdateAssetOrders = jest.mocked(updateAssetOrders);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function asset(id: string, name: string, order: number): Asset {
  return {
    id,
    aggregateVersion: 1,
    householdId: 'house-1',
    name,
    type: 'savings',
    currentBalance: 1_000_000,
    currency: 'KRW',
    isActive: true,
    order,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

function dataTransfer(): DataTransfer {
  return {
    effectAllowed: 'none',
    setData: jest.fn(),
  } as unknown as DataTransfer;
}

describe('AssetList reorder mutation feedback contract', () => {
  const showAlert = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAppDialog.mockReturnValue({
      showAlert,
      showConfirm: jest.fn(),
      showPrompt: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('순서 변경 명령 중에는 drag를 비활성화하고 중복 요청을 막으며 실패를 안내한다', async () => {
    const command = deferred<void>();
    mockedUpdateAssetOrders.mockReturnValue(command.promise);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AssetList
        assets={[
          asset('asset-1', '첫 자산', 0),
          asset('asset-2', '둘째 자산', 1),
        ]}
        onAssetClick={jest.fn()}
        onAddClick={jest.fn()}
      />
    );

    const first = screen.getByText('첫 자산').closest('[data-asset-id]');
    const second = screen.getByText('둘째 자산').closest('[data-asset-id]');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    fireEvent.dragStart(first!, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(second!, { dataTransfer: dataTransfer() });
    fireEvent.dragEnd(first!, { dataTransfer: dataTransfer() });

    expect(mockedUpdateAssetOrders).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAssetOrders).toHaveBeenCalledWith([
      { id: 'asset-2', order: 0 },
      { id: 'asset-1', order: 1 },
    ]);
    expect(first).toHaveAttribute('draggable', 'false');
    expect(second).toHaveAttribute('draggable', 'false');

    fireEvent.dragStart(second!, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(first!, { dataTransfer: dataTransfer() });
    fireEvent.dragEnd(second!, { dataTransfer: dataTransfer() });
    expect(mockedUpdateAssetOrders).toHaveBeenCalledTimes(1);

    await act(async () => {
      command.reject(new Error('ASSET_REORDER_FAILED'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(showAlert).toHaveBeenCalled();
      expect(first).toHaveAttribute('draggable', 'true');
      expect(second).toHaveAttribute('draggable', 'true');
    });

    consoleError.mockRestore();
  });
});
