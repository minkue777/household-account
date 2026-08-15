import { searchExpenses } from '@/lib/expenseService';
import { getDocs } from '@/platform/read-model/firestoreReadModel';

jest.mock('@/composition/clientSessionScope', () => ({
  requireClientSessionScope: () => ({ householdId: 'house-1', memberId: 'member-1' }),
}));

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  collection: jest.fn(() => ({ kind: 'collection' })),
  query: jest.fn(() => ({ kind: 'query' })),
  where: jest.fn(() => ({ kind: 'where' })),
  getDocs: jest.fn(),
  getDocsFromServer: jest.fn(),
  onSnapshot: jest.fn(),
  db: {},
}));

const mockedGetDocs = getDocs as jest.MockedFunction<typeof getDocs>;

function ledgerDocument(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    data: () => ({
      householdId: 'house-1',
      transactionType: 'expense',
      date: '2026-08-11',
      time: '12:00',
      merchant: 'matched merchant',
      amount: 10_000,
      category: 'etc',
      cardType: 'captured',
      cardDisplay: 'Samsung(3628)',
      aggregateVersion: 1,
      lifecycleState: 'active',
      ...overrides,
    }),
  };
}

describe('ledger search visibility contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('search returns only active transactions and prefers authoritative categoryId', async () => {
    mockedGetDocs.mockResolvedValue({
      docs: [
        ledgerDocument('active', { categoryId: 'food', category: 'etc' }),
        ledgerDocument('deleted', { lifecycleState: 'deleted' }),
        ledgerDocument('superseded', { lifecycleState: 'superseded' }),
        ledgerDocument('legacy-deleted', {
          lifecycleState: undefined,
          deletedAt: '2026-08-11T12:01:00.000Z',
        }),
      ],
    } as Awaited<ReturnType<typeof getDocs>>);

    await expect(searchExpenses('merchant')).resolves.toEqual([
      expect.objectContaining({
        id: 'active',
        category: 'food',
      }),
    ]);
  });
});
