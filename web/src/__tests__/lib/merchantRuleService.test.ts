/**
 * @jest-environment jsdom
 */

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => 'merchant_rules-collection'),
  doc: jest.fn((db, col, id) => ({ id })),
  addDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: jest.fn(),
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1234567890, nanoseconds: 0 })),
  },
}));

jest.mock('@/lib/firebase', () => ({
  db: {},
}));

import {
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import {
  addMerchantRule,
  addMerchantRuleV2,
  updateMerchantRule,
  updateMerchantRuleV2,
  deleteMerchantRule,
  ruleExists,
  ruleExistsV2,
  subscribeToRules,
  matchesMerchant,
  findMatchingRule,
  applyRule,
  MerchantRule,
} from '@/lib/merchantRuleService';

describe('merchantRuleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('matchesMerchant', () => {
    it('should match exact merchant name (case-insensitive)', () => {
      expect(matchesMerchant('Starbucks', 'starbucks', 'exact')).toBe(true);
      expect(matchesMerchant('STARBUCKS', 'starbucks', 'exact')).toBe(true);
      expect(matchesMerchant('Starbucks Coffee', 'starbucks', 'exact')).toBe(false);
    });

    it('should match merchant name containing keyword', () => {
      expect(matchesMerchant('Starbucks Coffee', 'starbucks', 'contains')).toBe(true);
      expect(matchesMerchant('My Starbucks Store', 'starbucks', 'contains')).toBe(true);
      expect(matchesMerchant('Coffee Shop', 'starbucks', 'contains')).toBe(false);
    });

    it('should match merchant name starting with keyword', () => {
      expect(matchesMerchant('Starbucks Coffee', 'starbucks', 'startsWith')).toBe(true);
      expect(matchesMerchant('My Starbucks', 'starbucks', 'startsWith')).toBe(false);
    });

    it('should match merchant name ending with keyword', () => {
      expect(matchesMerchant('My Starbucks', 'starbucks', 'endsWith')).toBe(true);
      expect(matchesMerchant('Starbucks Coffee', 'starbucks', 'endsWith')).toBe(false);
    });

    it('should match with regex pattern', () => {
      expect(matchesMerchant('Starbucks 강남점', 'starbucks.*점$', 'regex')).toBe(true);
      expect(matchesMerchant('효성에프엠에스', '효성.*', 'regex')).toBe(true);
      expect(matchesMerchant('Coffee Shop', 'starbucks.*', 'regex')).toBe(false);
    });

    it('should handle invalid regex gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      expect(matchesMerchant('Test', '[invalid(regex', 'regex')).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('findMatchingRule', () => {
    const createRule = (overrides: Partial<MerchantRule>): MerchantRule => ({
      id: 'rule-1',
      householdId: 'household-1',
      merchantKeyword: 'test',
      matchType: 'contains',
      mapping: { category: 'food' },
      priority: 0,
      isActive: true,
      ...overrides,
    });

    it('should return null when no rules match', () => {
      const rules = [createRule({ merchantKeyword: 'starbucks' })];
      expect(findMatchingRule('Coffee Shop', rules)).toBeNull();
    });

    it('should return matching rule', () => {
      const rules = [createRule({ merchantKeyword: 'coffee' })];
      const result = findMatchingRule('Coffee Shop', rules);
      expect(result).not.toBeNull();
      expect(result?.merchantKeyword).toBe('coffee');
    });

    it('should prioritize exact match over contains', () => {
      const rules = [
        createRule({ id: '1', merchantKeyword: 'coffee', matchType: 'contains', priority: 0 }),
        createRule({ id: '2', merchantKeyword: 'coffee shop', matchType: 'exact', priority: 0 }),
      ];
      const result = findMatchingRule('Coffee Shop', rules);
      expect(result?.id).toBe('2');
    });

    it('should prioritize higher priority rules', () => {
      const rules = [
        createRule({ id: '1', merchantKeyword: 'coffee', matchType: 'exact', priority: 1 }),
        createRule({ id: '2', merchantKeyword: 'coffee', matchType: 'exact', priority: 10 }),
      ];
      const result = findMatchingRule('Coffee', rules);
      expect(result?.id).toBe('2');
    });

    it('should skip inactive rules', () => {
      const rules = [
        createRule({ id: '1', merchantKeyword: 'coffee', isActive: false }),
        createRule({ id: '2', merchantKeyword: 'shop' }),
      ];
      const result = findMatchingRule('Coffee Shop', rules);
      expect(result?.id).toBe('2');
    });

    it('should handle legacy exactMatch field', () => {
      const legacyRule: any = {
        id: 'legacy-1',
        householdId: 'household-1',
        merchantKeyword: 'coffee shop',
        category: 'food',
        exactMatch: true,
        // no matchType field
      };
      const result = findMatchingRule('Coffee Shop', [legacyRule]);
      expect(result?.id).toBe('legacy-1');
    });
  });

  describe('applyRule', () => {
    const createRule = (overrides: Partial<MerchantRule>): MerchantRule => ({
      id: 'rule-1',
      householdId: 'household-1',
      merchantKeyword: 'test',
      matchType: 'contains',
      mapping: { category: 'food' },
      priority: 0,
      isActive: true,
      ...overrides,
    });

    it('should return null when no rules match', () => {
      const rules = [createRule({ merchantKeyword: 'starbucks' })];
      expect(applyRule('Coffee Shop', rules)).toBeNull();
    });

    it('should return mapped values', () => {
      const rules = [
        createRule({
          merchantKeyword: '효성',
          matchType: 'startsWith',
          mapping: {
            merchant: '어린이집 식판',
            category: 'childcare',
            memo: '자동 매핑됨',
          },
        }),
      ];

      const result = applyRule('효성에프엠에스', rules);

      expect(result).not.toBeNull();
      expect(result?.mappedValues.merchant).toBe('어린이집 식판');
      expect(result?.mappedValues.category).toBe('childcare');
      expect(result?.mappedValues.memo).toBe('자동 매핑됨');
    });

    it('should use original merchant name if not mapped', () => {
      const rules = [
        createRule({
          merchantKeyword: 'coffee',
          mapping: { category: 'food' },
        }),
      ];

      const result = applyRule('Coffee Shop', rules);

      expect(result?.mappedValues.merchant).toBe('Coffee Shop');
      expect(result?.mappedValues.category).toBe('food');
      expect(result?.mappedValues.memo).toBe('');
    });

    it('should handle legacy category field', () => {
      const legacyRule: any = {
        id: 'legacy-1',
        householdId: 'household-1',
        merchantKeyword: 'coffee',
        category: 'food',
        exactMatch: false,
        // no mapping field
      };

      const result = applyRule('Coffee Shop', [legacyRule]);

      expect(result?.mappedValues.category).toBe('food');
    });
  });

  describe('addMerchantRule (legacy API)', () => {
    it('should return empty string for empty householdId', async () => {
      const result = await addMerchantRule('', 'keyword', 'food');

      expect(result).toBe('');
      expect(addDoc).not.toHaveBeenCalled();
    });

    it('should not add if rule already exists', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: false });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await addMerchantRule('household-1', 'existing-keyword', 'food');

      expect(result).toBe('');
      expect(addDoc).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should add rule if not exists', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: true });
      (addDoc as jest.Mock).mockResolvedValue({ id: 'new-rule-id' });

      const result = await addMerchantRule('household-1', 'new-keyword', 'food', true);

      expect(addDoc).toHaveBeenCalled();
      expect(result).toBe('new-rule-id');
    });
  });

  describe('addMerchantRuleV2', () => {
    it('should add rule with new format', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: true });
      (addDoc as jest.Mock).mockResolvedValue({ id: 'new-rule-id' });

      const result = await addMerchantRuleV2('household-1', {
        merchantKeyword: '효성',
        matchType: 'startsWith',
        mapping: {
          merchant: '어린이집 식판',
          category: 'childcare',
        },
        priority: 10,
      });

      expect(result).toBe('new-rule-id');

      const addDocCall = (addDoc as jest.Mock).mock.calls[0][1];
      expect(addDocCall.merchantKeyword).toBe('효성');
      expect(addDocCall.matchType).toBe('startsWith');
      expect(addDocCall.mapping.merchant).toBe('어린이집 식판');
      expect(addDocCall.mapping.category).toBe('childcare');
      expect(addDocCall.priority).toBe(10);
      expect(addDocCall.isActive).toBe(true);
    });
  });

  describe('updateMerchantRule (legacy API)', () => {
    it('should update rule category via mapping', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await updateMerchantRule('rule-id', 'shopping');

      const updateDocCall = (updateDoc as jest.Mock).mock.calls[0][1];
      expect(updateDocCall.mapping.category).toBe('shopping');
    });
  });

  describe('updateMerchantRuleV2', () => {
    it('should update rule with new format', async () => {
      (updateDoc as jest.Mock).mockResolvedValue(undefined);

      await updateMerchantRuleV2('rule-id', {
        matchType: 'regex',
        mapping: { merchant: 'New Name', category: 'shopping' },
        priority: 5,
      });

      const updateDocCall = (updateDoc as jest.Mock).mock.calls[0][1];
      expect(updateDocCall.matchType).toBe('regex');
      expect(updateDocCall.mapping.merchant).toBe('New Name');
      expect(updateDocCall.priority).toBe(5);
    });
  });

  describe('deleteMerchantRule', () => {
    it('should delete rule', async () => {
      (deleteDoc as jest.Mock).mockResolvedValue(undefined);

      await deleteMerchantRule('rule-id');

      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  describe('ruleExists (legacy API)', () => {
    it('should return true if rule exists', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: false });

      const result = await ruleExists('household-1', 'existing-keyword');

      expect(result).toBe(true);
    });

    it('should return false if rule does not exist', async () => {
      (getDocs as jest.Mock).mockResolvedValue({ empty: true });

      const result = await ruleExists('household-1', 'new-keyword');

      expect(result).toBe(false);
    });
  });

  describe('subscribeToRules', () => {
    it('should return empty callback for empty householdId', () => {
      const callback = jest.fn();

      const unsubscribe = subscribeToRules('', callback);

      expect(callback).toHaveBeenCalledWith([]);
      expect(unsubscribe).toBeInstanceOf(Function);
    });

    it('should subscribe to rules and transform to new format', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, onNext) => {
        onNext({
          docs: [
            {
              id: 'rule-1',
              data: () => ({
                householdId: 'household-1',
                merchantKeyword: 'Starbucks',
                matchType: 'exact',
                mapping: { category: 'food' },
                priority: 5,
                isActive: true,
              }),
            },
          ],
        });
        return mockUnsubscribe;
      });

      const unsubscribe = subscribeToRules('household-1', callback);

      expect(callback).toHaveBeenCalled();
      const calledRules = callback.mock.calls[0][0];
      expect(calledRules).toHaveLength(1);
      expect(calledRules[0].merchantKeyword).toBe('Starbucks');
      expect(calledRules[0].matchType).toBe('exact');
      expect(calledRules[0].mapping.category).toBe('food');
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('should transform legacy rules', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();

      (onSnapshot as jest.Mock).mockImplementation((q, onNext) => {
        onNext({
          docs: [
            {
              id: 'legacy-rule',
              data: () => ({
                householdId: 'household-1',
                merchantKeyword: 'OldStore',
                category: 'shopping',
                exactMatch: true,
                // no matchType or mapping
              }),
            },
          ],
        });
        return mockUnsubscribe;
      });

      subscribeToRules('household-1', callback);

      const calledRules = callback.mock.calls[0][0];
      expect(calledRules[0].matchType).toBe('exact');
      expect(calledRules[0].mapping.category).toBe('shopping');
    });

    it('should handle subscription errors', () => {
      const callback = jest.fn();
      const mockUnsubscribe = jest.fn();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (onSnapshot as jest.Mock).mockImplementation((q, onNext, onError) => {
        onError(new Error('Subscription error'));
        return mockUnsubscribe;
      });

      subscribeToRules('household-1', callback);

      expect(callback).toHaveBeenCalledWith([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
