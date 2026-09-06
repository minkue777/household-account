import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import type { CreateRecurringExpenseInput } from '@/types/recurring';

export const recurringCommands = {
  async create(householdId: string, plan: CreateRecurringExpenseInput): Promise<string> {
    const result = await getHouseholdCommandClient().execute(
      'recurring.create-plan.v1',
      { plan: { ...plan } },
      { householdId }
    );
    return result.planId;
  },

  async update(
    householdId: string,
    planId: string,
    changes: Partial<CreateRecurringExpenseInput & { isActive: boolean }>,
    expectedVersion: number
  ): Promise<void> {
    await getHouseholdCommandClient().execute(
      'recurring.update-plan.v1',
      { planId, changes: { ...changes }, expectedVersion },
      { householdId }
    );
  },

  async delete(householdId: string, planId: string, expectedVersion: number): Promise<void> {
    await getHouseholdCommandClient().execute(
      'recurring.delete-plan.v1',
      { planId, expectedVersion },
      { householdId }
    );
  },
};
