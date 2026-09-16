import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MerchantRule } from '@/types/merchant';
const mockReorder = jest.fn();
const mockUpdate = jest.fn();
const mockRules: MerchantRule[] = [
  { id: 'a', householdId: 'house', merchantKeyword: 'A', matchType: 'contains', priority: 30, mapping: { merchant: '치환 이름', memo: '치환 메모', category: 'food' }, version: 1, collectionVersion: 4 },
  { id: 'b', householdId: 'house', merchantKeyword: 'B', matchType: 'contains', priority: 20, mapping: {}, collectionVersion: 4 },
  { id: 'inactive', householdId: 'house', merchantKeyword: 'C', matchType: 'contains', priority: 10, mapping: {}, collectionVersion: 4, isActive: false },
];
jest.mock('@/lib/merchantRuleService', () => ({
  subscribeToRules: (_household: string, callback: (rules: MerchantRule[]) => void) => { callback(mockRules); return jest.fn(); },
  reorderMerchantRules: (...args: unknown[]) => mockReorder(...args),
  updateMerchantRuleV2: (...args: unknown[]) => mockUpdate(...args),
  MATCH_TYPE_LABELS: { contains: '포함' },
}));
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: 'house' }) }));
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({ activeCategories: [], getCategoryLabel: (id: string) => id, getCategoryColor: () => '#000000' }) }));
import MerchantRuleSettings from '@/components/settings/MerchantRuleSettings';

describe('[MER-004] rule reorder UI', () => {
  beforeEach(() => {
    mockReorder.mockReset();
    mockUpdate.mockReset().mockResolvedValue(undefined);
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });
  test('[MER-003] 기존 가맹점·메모 치환을 지우면 명시적인 빈 값으로 제출한다', async () => {
    render(<MerchantRuleSettings />);
    fireEvent.click(screen.getByRole('button', { name: /가맹점 규칙/ }));
    fireEvent.click(screen.getByRole('button', { name: 'A 규칙 수정' }));
    fireEvent.change(screen.getByPlaceholderText('비워두면 원본 가맹점명 유지'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('자동으로 추가될 메모'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a', {
      merchantKeyword: 'A', matchType: 'contains', mapping: { merchant: '', memo: '', category: 'food' },
    }, 1));
  });
  test('moves one rule with all same-type rules including inactive ones and reports a stale failure', async () => {
    mockReorder.mockRejectedValue(new Error('VERSION_MISMATCH'));
    render(<MerchantRuleSettings />);
    fireEvent.click(screen.getByRole('button', { name: /가맹점 규칙/ }));
    fireEvent.click(screen.getByRole('button', { name: 'B 우선순위 올리기' }));
    await waitFor(() => expect(mockReorder).toHaveBeenCalledWith('house', 'contains', [mockRules[1], mockRules[0], mockRules[2]]));
    expect(mockReorder.mock.calls[0][2].every((rule: MerchantRule) => rule.collectionVersion === 4)).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_MISMATCH');
  });
});
