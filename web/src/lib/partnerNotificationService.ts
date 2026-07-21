import { ledgerCommands } from '@/features/ledger/application/ledgerCommands';
import { requireClientSessionScope } from '@/composition/clientSessionScope';

/**
 * 지출 알림 전송 요청
 */
export async function notifyPartner(id: string, expectedVersion: number): Promise<void> {
  const householdId = requireClientSessionScope().householdId;
  await ledgerCommands.requestNotification(householdId, id, expectedVersion);
}
