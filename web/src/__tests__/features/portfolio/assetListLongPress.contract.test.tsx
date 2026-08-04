import { act, fireEvent, render, screen } from '@testing-library/react';

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
  default: ({ asset, onClick }: { asset: Asset; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {asset.name}
    </button>
  ),
}));

const mockedUseAppDialog = jest.mocked(useAppDialog);
const mockedUpdateAssetOrders = jest.mocked(updateAssetOrders);
const elementsFromPoint = jest.fn<Element[], [number, number]>();

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

function renderAssetList(onAssetClick = jest.fn()) {
  render(
    <AssetList
      assets={[
        asset('asset-1', '첫 번째 자산', 0),
        asset('asset-2', '두 번째 자산', 1),
      ]}
      onAssetClick={onAssetClick}
      onAddClick={jest.fn()}
    />
  );

  const firstButton = screen.getByRole('button', { name: '첫 번째 자산' });
  const secondButton = screen.getByRole('button', { name: '두 번째 자산' });
  const first = firstButton.closest('[data-asset-id]');
  const second = secondButton.closest('[data-asset-id]');

  if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
    throw new Error('자산 목록 행을 찾을 수 없습니다.');
  }

  elementsFromPoint.mockReturnValue([second]);
  return { first, second, firstButton, secondButton, onAssetClick };
}

function touchStart(element: Element, x = 10, y = 10) {
  fireEvent.touchStart(element, {
    touches: [{ clientX: x, clientY: y }],
  });
}

function touchMove(element: Element, x: number, y: number) {
  fireEvent.touchMove(element, {
    touches: [{ clientX: x, clientY: y }],
  });
}

describe('AssetList 모바일 롱프레스 순서 변경 계약', () => {
  const originalElementsFromPoint = document.elementsFromPoint;

  beforeAll(() => {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockedUseAppDialog.mockReturnValue({
      showAlert: jest.fn().mockResolvedValue(undefined),
      showConfirm: jest.fn(),
      showPrompt: jest.fn(),
    });
    mockedUpdateAssetOrders.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    if (originalElementsFromPoint) {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
      return;
    }
    delete (document as { elementsFromPoint?: typeof document.elementsFromPoint })
      .elementsFromPoint;
  });

  test('500ms 경계에서 렌더를 기다리지 않고 이동과 종료를 이어도 순서를 변경한다', async () => {
    const { first } = renderAssetList();

    touchStart(first);
    await act(async () => {
      jest.advanceTimersByTime(500);
      touchMove(first, 10, 80);
      fireEvent.touchEnd(first);
      await Promise.resolve();
    });

    expect(mockedUpdateAssetOrders).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAssetOrders).toHaveBeenCalledWith([
      { id: 'asset-2', order: 0 },
      { id: 'asset-1', order: 1 },
    ]);
  });

  test('롱프레스 전 12px 미세 이동은 취소하지 않는다', async () => {
    const { first } = renderAssetList();

    touchStart(first, 10, 10);
    touchMove(first, 10, 22);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    await act(async () => {
      touchMove(first, 10, 80);
      fireEvent.touchEnd(first);
      await Promise.resolve();
    });

    expect(mockedUpdateAssetOrders).toHaveBeenCalledWith([
      { id: 'asset-2', order: 0 },
      { id: 'asset-1', order: 1 },
    ]);
  });

  test('롱프레스 전 17px 이동은 순서 변경을 취소한다', () => {
    const { first } = renderAssetList();

    touchStart(first, 10, 10);
    touchMove(first, 10, 27);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    touchMove(first, 10, 80);
    fireEvent.touchEnd(first);

    expect(mockedUpdateAssetOrders).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  test('touchcancel은 활성화된 순서 변경과 네이티브 drag 차단 상태를 함께 정리한다', () => {
    const { first } = renderAssetList();

    touchStart(first);
    expect(first).toHaveAttribute('draggable', 'false');

    act(() => {
      jest.advanceTimersByTime(500);
    });
    touchMove(first, 10, 80);
    fireEvent.touchCancel(first);
    fireEvent.touchEnd(first);

    expect(mockedUpdateAssetOrders).not.toHaveBeenCalled();
    expect(first).toHaveAttribute('draggable', 'true');
    expect(first).not.toHaveClass('opacity-50', 'scale-95');
  });

  test('터치가 시작되면 HTML native drag를 비활성화하고 dragstart도 차단한다', () => {
    const { first } = renderAssetList();

    expect(first).toHaveAttribute('draggable', 'true');
    touchStart(first);
    expect(first).toHaveAttribute('draggable', 'false');

    const dragStarted = fireEvent.dragStart(first, {
      dataTransfer: dataTransfer(),
    });
    expect(dragStarted).toBe(false);

    fireEvent.touchEnd(first);
    expect(first).toHaveAttribute('draggable', 'true');
  });

  test('롱프레스 종료 직후 발생하는 합성 click 한 번만 억제한다', () => {
    const onAssetClick = jest.fn();
    const { first, firstButton } = renderAssetList(onAssetClick);

    touchStart(first);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    fireEvent.touchEnd(first);

    fireEvent.click(firstButton);
    expect(onAssetClick).not.toHaveBeenCalled();

    fireEvent.click(firstButton);
    expect(onAssetClick).toHaveBeenCalledTimes(1);
  });
});
