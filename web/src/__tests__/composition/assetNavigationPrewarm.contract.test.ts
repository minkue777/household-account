const mockUnsubscribeAssets = jest.fn();
const mockSubscribeToAssets = jest.fn(() => mockUnsubscribeAssets);
const mockWarmStockInstrumentCatalog = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/assetService', () => ({
  subscribeToAssets: () => mockSubscribeToAssets(),
}));

jest.mock('@/composition/stockInstrumentCatalogRuntime', () => ({
  warmStockInstrumentCatalog: () => mockWarmStockInstrumentCatalog(),
}));

import { warmAssetNavigationIntent } from '@/composition/assetNavigationPrewarm';

describe('asset navigation intent prewarm contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('동시 pointer/focus 신호를 합치고 임시 asset listener를 제한된 시간만 유지한다', async () => {
    await Promise.all([
      warmAssetNavigationIntent(),
      warmAssetNavigationIntent(),
    ]);

    expect(mockSubscribeToAssets).toHaveBeenCalledTimes(1);
    expect(mockWarmStockInstrumentCatalog).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(29_999);
    expect(mockUnsubscribeAssets).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(mockUnsubscribeAssets).toHaveBeenCalledTimes(1);

    await warmAssetNavigationIntent();
    expect(mockSubscribeToAssets).toHaveBeenCalledTimes(2);
    expect(mockWarmStockInstrumentCatalog).toHaveBeenCalledTimes(1);
  });
});
