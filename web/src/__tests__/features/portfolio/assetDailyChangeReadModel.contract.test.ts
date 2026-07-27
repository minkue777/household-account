jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  collection: jest.fn(),
  db: { kind: 'firestore' },
  getDocs: jest.fn(),
  limit: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from '@/platform/read-model/firestoreReadModel';
import { readPreviousAssetDailySummary } from '@/platform/read-model/assetDailyChangeReadModel';

describe('자산 일간 변동 Firestore 읽기 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (collection as jest.Mock).mockReturnValue('asset-snapshots');
    (where as jest.Mock).mockReturnValue('before-today');
    (orderBy as jest.Mock).mockReturnValue('latest-first');
    (limit as jest.Mock).mockReturnValue('one-document');
    (query as jest.Mock).mockReturnValue('summary-query');
  });

  test('[T-PERF-HOLD-002][JOB-AST-002] 명의자 수와 무관하게 전일 Canonical 요약을 최대 한 건만 조회한다', async () => {
    (getDocs as jest.Mock).mockResolvedValue({
      empty: false,
      docs: [
        {
          id: '2026-07-27',
          data: () => ({
            localDate: '2026-07-27',
            total: 1_000,
            byOwnerRefKey: {
              'profile:profile-min': 600,
              'profile:profile-jin': 400,
              invalid: 'not-number',
            },
          }),
        },
      ],
    });

    await expect(
      readPreviousAssetDailySummary('house-1', '2026-07-28')
    ).resolves.toEqual({
      localDate: '2026-07-27',
      total: 1_000,
      byOwnerRefKey: {
        'profile:profile-min': 600,
        'profile:profile-jin': 400,
      },
    });

    expect(collection).toHaveBeenCalledWith(
      { kind: 'firestore' },
      'households',
      'house-1',
      'assetSnapshots'
    );
    expect(where).toHaveBeenCalledWith('localDate', '<', '2026-07-28');
    expect(orderBy).toHaveBeenCalledWith('localDate', 'desc');
    expect(limit).toHaveBeenCalledWith(1);
    expect(query).toHaveBeenCalledWith(
      'asset-snapshots',
      'before-today',
      'latest-first',
      'one-document'
    );
    expect(getDocs).toHaveBeenCalledTimes(1);
  });

  test('전일 요약이 없으면 기준값 없음으로 반환한다', async () => {
    (getDocs as jest.Mock).mockResolvedValue({
      empty: true,
      docs: [],
    });

    await expect(
      readPreviousAssetDailySummary('house-1', '2026-07-28')
    ).resolves.toBeUndefined();
  });
});
