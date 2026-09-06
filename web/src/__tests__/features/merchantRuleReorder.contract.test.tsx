import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MerchantRule } from '@/types/merchant';
const mockReorder = jest.fn();
const mockRules: MerchantRule[] = [
  { id: 'a', householdId: 'house', merchantKeyword: 'A', matchType: 'contains', priority: 30, mapping: {}, collectionVersion: 4 },
  { id: 'b', householdId: 'house', merchantKeyword: 'B', matchType: 'contains', priority: 20, mapping: {}, collectionVersion: 4 },
  { id: 'inactive', householdId: 'house', merchantKeyword: 'C', matchType: 'contains', priority: 10, mapping: {}, collectionVersion: 4, isActive: false },
];
jest.mock('@/lib/merchantRuleService', () => ({
  subscribeToRules: (_household: string, callback: (rules: MerchantRule[]) => void) => { callback(mockRules); return jest.fn(); },
  reorderMerchantRules: (...args: unknown[]) => mockReorder(...args),
  MATCH_TYPE_LABELS: { contains: '포함' },
}));
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: 'house' }) }));
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({ activeCategories: [], getCategoryLabel: (id: string) => id, getCategoryColor: () => '#000000' }) }));
import MerchantRuleSettings from '@/components/settings/MerchantRuleSettings';

describe('[MER-004] rule reorder UI', () => {
  beforeEach(() => mockReorder.mockReset());
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
