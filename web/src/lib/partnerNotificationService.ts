import { requireClientSessionScope } from '@/composition/clientSessionScope';

/**
 * 지출 알림 전송 요청
 */
export async function notifyPartner(id: string, expectedVersion: number): Promise<void> {
  const householdId = requireClientSessionScope().householdId;
  const { ledgerCommands } = await import('@/features/ledger/application/ledgerCommands');
  await ledgerCommands.requestNotification(householdId, id, expectedVersion);
}
