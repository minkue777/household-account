const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockOnSnapshot = jest.fn();
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {},
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));
jest.mock('@/composition/clientSessionScope', () => ({ requireClientSessionScope: () => ({ householdId: 'house' }) }));

import { getRules, subscribeToRules } from '@/lib/merchantRuleService';

const ruleDocument = {
  id: 'coffee',
  data: () => ({
    householdId: 'house', keyword: '커피점', matchType: 'contains', priority: 20,
    mapping: { merchant: '우리 카페', categoryId: 'snack', memo: '원두' },
    active: false, aggregateVersion: 3,
  }),
};
const metadata = { data: () => ({ collectionVersions: { 'house:contains': 7 } }) };
const expected = {
  id: 'coffee', householdId: 'house', merchantKeyword: '커피점', matchType: 'contains', priority: 20,
  mapping: { merchant: '우리 카페', category: 'snack', memo: '원두' },
  isActive: false, version: 3, collectionVersion: 7,
};

describe('[MER-003][MER-004] canonical 가맹점 규칙 조회', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocs.mockResolvedValue({ docs: [ruleDocument] });
    mockGetDoc.mockResolvedValue(metadata);
    mockOnSnapshot.mockImplementation(() => jest.fn());
  });

  test('canonical의 카테고리·활성 상태·version을 설정 화면 모델로 읽는다', async () => {
    expect(await getRules('house')).toEqual([expect.objectContaining(expected)]);
    expect(mockGetDocs).toHaveBeenCalledWith({ path: 'households/house/merchantRules' });
    expect(mockGetDoc).toHaveBeenCalledWith({ path: 'households/house/paymentConfigurationMeta/merchant-rules' });
  });

  test.each([true, false])('목록과 version 도착 순서가 달라도 함께 표시한다: 목록 먼저=%s', (rulesFirst) => {
    const publish = jest.fn();
    const stop = subscribeToRules('house', publish);
    const meta = mockOnSnapshot.mock.calls.find(([reference]) => reference.path.endsWith('/merchant-rules'))!;
    const rules = mockOnSnapshot.mock.calls.find(([reference]) => reference.path.endsWith('/merchantRules'))!;
    const publishRules = () => rules[1]({ docs: [ruleDocument] });
    const publishMeta = () => meta[1](metadata);
    (rulesFirst ? publishRules : publishMeta)();
    expect(publish).not.toHaveBeenCalled();
    (rulesFirst ? publishMeta : publishRules)();
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining(expected)]);
    stop();
    expect(mockOnSnapshot.mock.results.every(result => result.value.mock.calls.length === 1)).toBe(true);
  });
});
