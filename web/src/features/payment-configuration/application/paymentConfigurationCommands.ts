import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import { HouseholdCommandError } from '@/platform/functions-api';
import type { CreateMerchantRuleInput, MerchantRule } from '@/types/merchant';

function isDuplicate(error: unknown): boolean {
  return error instanceof HouseholdCommandError &&
    ['DUPLICATE', 'ALREADY_EXISTS', 'RULE_ALREADY_EXISTS', 'CARD_ALREADY_EXISTS'].includes(error.code);
}

export const paymentConfigurationCommands = {
  async reorderMerchantRules(householdId: string, matchType: 'startsWith' | 'endsWith' | 'contains', orderedRuleIds: string[], expectedCollectionVersion: number): Promise<void> {
    await getHouseholdCommandClient().execute('payment-configuration.reorder-merchant-rules.v1', { matchType, orderedRuleIds, expectedCollectionVersion }, { householdId });
  },
  async createMerchantRule(householdId: string, rule: CreateMerchantRuleInput): Promise<string> {
    try {
      const result = await getHouseholdCommandClient().execute(
        'payment-configuration.create-merchant-rule.v1',
        { rule: { ...rule } },
        { householdId }
      );
      return result.ruleId;
    } catch (error) {
      if (isDuplicate(error)) return '';
      throw error;
    }
  },

  async updateMerchantRule(
    householdId: string,
    ruleId: string,
    changes: Partial<Pick<MerchantRule, 'merchantKeyword' | 'matchType' | 'mapping' | 'priority' | 'isActive'>>,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'payment-configuration.update-merchant-rule.v1',
      { ruleId, changes: { ...changes }, expectedVersion },
      { householdId }
    );
  },

  async deleteMerchantRule(householdId: string, ruleId: string, expectedVersion: number): Promise<void> {
    await getHouseholdCommandClient().execute(
      'payment-configuration.delete-merchant-rule.v1',
      { ruleId, expectedVersion },
      { householdId }
    );
  },

  async registerCard(
    householdId: string,
    card: { cardLabel: string; cardLastFour: string }
  ): Promise<string> {
    try {
      const result = await getHouseholdCommandClient().execute(
        'payment-configuration.register-card.v1',
        { card },
        { householdId }
      );
      return result.cardId;
    } catch (error) {
      if (isDuplicate(error)) return '';
      throw error;
    }
  },

  async updateCard(
    householdId: string,
    cardId: string,
    changes: { cardLabel?: string; cardLastFour?: string },
    expectedVersion: number
  ): Promise<boolean> {
    try {
      await getHouseholdCommandClient().execute(
        'payment-configuration.update-card.v1',
        { cardId, changes, expectedVersion },
        { householdId }
      );
      return true;
    } catch (error) {
      if (isDuplicate(error)) return false;
      throw error;
    }
  },

  async deleteCard(householdId: string, cardId: string, expectedVersion: number): Promise<void> {
    await getHouseholdCommandClient().execute(
      'payment-configuration.delete-card.v1',
      { cardId, expectedVersion },
      { householdId }
    );
  },

  async reorderCards(householdId: string, cardIds: string[], expectedCollectionVersion: number): Promise<void> {
    await getHouseholdCommandClient().execute(
      'payment-configuration.reorder-cards.v1',
      { cardIds, expectedCollectionVersion },
      { householdId }
    );
  },
};
