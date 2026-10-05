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
  onDocumentSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));
jest.mock('@/composition/clientSessionScope', () => ({ requireClientSessionScope: () => ({ householdId: 'house' }) }));

import { subscribeToRules } from '@/lib/merchantRuleService';

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

  test.each([true, false])('목록과 version 도착 순서가 달라도 함께 표시한다: 목록 먼저=%s', (rulesFirst) => {
    const publish = jest.fn();
    const stop = subscribeToRules('house', publish, jest.fn());
    const meta = mockOnSnapshot.mock.calls.find(([reference]) => reference.path.endsWith('/merchant-rules'))!;
    const rules = mockOnSnapshot.mock.calls.find(([reference]) => reference.path.endsWith('/merchantRules'))!;
    const publishRules = () => rules[2]({ docs: [ruleDocument] });
    const publishMeta = () => meta[2](metadata);
    (rulesFirst ? publishRules : publishMeta)();
    expect(publish).not.toHaveBeenCalled();
    (rulesFirst ? publishMeta : publishRules)();
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining(expected)]);
    stop();
    expect(mockOnSnapshot.mock.results.every(result => result.value.mock.calls.length === 1)).toBe(true);
  });
  test.each([0, 1])('구독 %s 실패는 마지막 성공을 보존하고 빈 목록이나 늦은 결과를 보내지 않는다', index => {
    const publish = jest.fn();
    const failed = jest.fn();
    const stop = subscribeToRules('house', publish, failed);
    const [meta, rules] = mockOnSnapshot.mock.calls;
    meta[2](metadata);
    rules[2]({ docs: [ruleDocument] });
    const error = new Error('permission-denied');
    mockOnSnapshot.mock.calls[index][3](error);
    expect(failed).toHaveBeenCalledWith(error);
    rules[2]({ docs: [] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining(expected)]);
    stop();
    meta[2](metadata);
    expect(publish).toHaveBeenCalledTimes(1);
  });

});
