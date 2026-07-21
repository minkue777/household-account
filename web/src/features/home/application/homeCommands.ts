import { getHouseholdCommandClient } from '@/composition/webCommandRuntime';
import type { HomeSummaryConfig } from '@/types/household';

export async function updateHomeSummaryPreferences(
  householdId: string,
  config: HomeSummaryConfig
): Promise<void> {
  await getHouseholdCommandClient().execute(
    'home.update-summary-preferences.v1',
    config,
    { householdId }
  );
}
