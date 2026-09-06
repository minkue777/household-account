import type { Firestore } from 'firebase-admin/firestore';
import { createHouseholdPurgeProcessApplication } from '../../contexts/access/household-purge-process/application/householdPurgeProcessApplication';
import { FirebaseHouseholdPurgeUnitOfWork, purgeHash } from '../../adapters/firebase/access/firebaseHouseholdPurgeUnitOfWork';
import { firebaseScopedPurgeParticipant, remainingHouseholdCollections, scopedCollections } from '../../adapters/firebase/shared/firebaseScopedPurgePage';
import { createFirebaseNotificationHouseholdPurgeApplication } from '../../adapters/firebase/notifications/firebaseNotificationHouseholdPurgeStore';
import { withShortcutReceiptOwnershipPreflight } from '../../adapters/firebase/payment-capture/firebaseShortcutReceiptPurgePreflight';
import type { HouseholdPurgeParticipantPort } from '../../contexts/access/household-purge-process/application/ports/out/householdPurgeProcessPorts';
import type { HouseholdPurgeParticipant } from '../../contexts/access/household-purge-process/domain/model/householdPurgeProcess';

export function createFirebaseHouseholdPurgeRuntime(db: Firestore, input: { householdId: string; idempotencyKey: string; operatorRef: string; pageSize?: number }) {
  const processId = purgeHash(`household-purge:${input.householdId}:${input.idempotencyKey}`);
  const pageSize = input.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('INVALID_PURGE_PAGE_SIZE');
  const store = new FirebaseHouseholdPurgeUnitOfWork(db, input.householdId, processId, input.operatorRef);
  const household = db.collection('households').doc(input.householdId);
  const participant = (names: readonly string[], legacy: readonly string[]) => firebaseScopedPurgeParticipant(db, async id => [
    ...names.map(name => household.collection(name)), ...scopedCollections(db, id, legacy),
  ], pageSize);
  const participants: Partial<Record<HouseholdPurgeParticipant, HouseholdPurgeParticipantPort>> = {
    'household-finance': withShortcutReceiptOwnershipPreflight(db, participant(['ledgerTransactions', 'ledgerDedupKeys', 'categories', 'categorySettings', 'categoryArchiveProcesses', 'recurringPlans', 'recurringCommandReceipts', 'categoryRecurringRemapReceipts', 'localCurrencyBalances'], ['expenses', 'categories', 'recurring_expenses']), pageSize),
    'payment-capture': participant(['registeredCards', 'merchantRules', 'paymentConfigurationMeta'], ['registered_cards', 'merchant_rules', 'captureReceipts', 'shortcutReceipts', 'shortcutHttpReceipts', 'notification_debug_logs', 'shortcutCredentials', 'shortcutCredentialVersions']),
    portfolio: participant(['assets', 'assetAutomationPlans', 'assetAutomationPlanRevisions', 'assetAutomationExecutions', 'assetAutomationExecutionReceipts'], ['assets', 'stock_holdings', 'crypto_holdings', 'dividend_events', 'dividend_snapshots', 'asset_history']),
    'access-household': firebaseScopedPurgeParticipant(db, async id => [
      ...await remainingHouseholdCollections(db, id, processId),
      ...scopedCollections(db, id, ['householdInvitations', 'legacyMembershipClaims', 'outboxEvents']),
      db.collectionGroup('householdMembershipViews').where('householdId', '==', id),
      db.collectionGroup('receipts').where('householdId', '==', id),
      db.collection('operations/runtime/memberAccessStats').where('householdId', '==', id),
      db.collection('operations/runtime/memberAccessVisits').where('householdId', '==', id),
    ], pageSize),
  };
  const notifications = createFirebaseNotificationHouseholdPurgeApplication(db, pageSize);
  const application = createHouseholdPurgeProcessApplication({
    unitOfWork: store, execution: store, claimPageSize: pageSize,
    identities: { processId: () => processId }, hash: { hash: purgeHash }, clock: { now: () => new Date().toISOString() },
    faults: { beforeStep: () => ({ kind: 'proceed' }) },
    participants: {
      async purgeHouseholdData(request) {
        if (request.participant !== 'notifications') return participants[request.participant]!.purgeHouseholdData(request);
        let result;
        try { result = await notifications.purgeHouseholdData(
          { systemRef: 'household-purge-cli', capabilities: ['householdLifecycle:purge'] },
          { householdId: request.householdId, processId: request.processId, checkpoint: request.checkpoint === 'notifications:start' ? 'START' : request.checkpoint },
        ); } catch (error) {
          if (error instanceof Error && error.message.startsWith('NOTIFICATION_LEGACY_OWNERSHIP_UNRESOLVED:')) {
            return { kind: 'permanent-failure', failedCheckpoint: request.checkpoint, errorCode: 'NOTIFICATION_LEGACY_OWNERSHIP_UNRESOLVED' };
          }
          return { kind: 'retryable-failure', retryCheckpoint: request.checkpoint, errorCode: 'NOTIFICATIONS_PURGE_UNAVAILABLE' };
        }
        if (result.kind === 'PageProcessed') return { kind: 'page-processed', nextCheckpoint: result.nextCheckpoint, deletedCount: result.deletedCount };
        if (result.kind === 'PurgeCompleted') return { kind: 'purge-completed', finalCheckpoint: 'notifications:complete', deletedCount: result.deletedCount };
        return { kind: 'permanent-failure', failedCheckpoint: request.checkpoint, errorCode: 'NOTIFICATIONS_PURGE_FORBIDDEN' };
      },
    },
  });
  return { processId, application };
}
