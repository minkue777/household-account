const mockOnSnapshot = jest.fn();
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {},
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
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
const expected = {
  id: 'coffee', householdId: 'house', merchantKeyword: '커피점', matchType: 'contains', priority: 20,
  mapping: { merchant: '우리 카페', category: 'snack', memo: '원두' },
  isActive: false, version: 3,
};

describe('[MER-003][MER-004] canonical 가맹점 규칙 조회', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnSnapshot.mockImplementation(() => jest.fn());
  });

  test('규칙 목록만 구독하며 문서 version과 함께 즉시 표시한다', () => {
    const publish = jest.fn();
    const stop = subscribeToRules('house', publish, jest.fn());
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    const rules = mockOnSnapshot.mock.calls[0];
    expect(rules[0].path).toBe('households/house/merchantRules');
    rules[2]({ docs: [ruleDocument] });
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining(expected)]);
    stop();
    expect(mockOnSnapshot.mock.results.every(result => result.value.mock.calls.length === 1)).toBe(true);
    rules[2]({ docs: [] });
    expect(publish).toHaveBeenCalledTimes(1);
  });
  test('구독 실패는 마지막 성공을 보존하고 빈 목록이나 늦은 결과를 보내지 않는다', () => {
    const publish = jest.fn();
    const failed = jest.fn();
    const stop = subscribeToRules('house', publish, failed);
    const [rules] = mockOnSnapshot.mock.calls;
    rules[2]({ docs: [ruleDocument] });
    const error = new Error('permission-denied');
    rules[3](error);
    expect(failed).toHaveBeenCalledWith(error);
    rules[2]({ docs: [] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining(expected)]);
    stop();
    rules[2]({ docs: [ruleDocument] });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test('구독 시작 실패도 오류로 전달하며 빈 성공으로 바꾸지 않는다', () => {
    const error = new Error('unavailable');
    mockOnSnapshot.mockImplementationOnce(() => { throw error; });
    const publish = jest.fn();
    const failed = jest.fn();
    const stop = subscribeToRules('house', publish, failed);
    expect(failed).toHaveBeenCalledWith(error);
    expect(publish).not.toHaveBeenCalled();
    stop();
  });

});
