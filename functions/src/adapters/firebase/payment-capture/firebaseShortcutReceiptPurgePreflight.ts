import type { Firestore } from 'firebase-admin/firestore';
import type { HouseholdPurgeParticipantPort } from '../../../contexts/access/household-purge-process/application/ports/out/householdPurgeProcessPorts';

/** Resolve old HTTP receipts while the expense owner document still exists. */
export function withShortcutReceiptOwnershipPreflight(db: Firestore, next: HouseholdPurgeParticipantPort, pageSize: number): HouseholdPurgeParticipantPort {
  const prefix = 'household-finance:receipt-ownership:';
  return {
    async purgeHouseholdData(input) {
      if (input.checkpoint !== 'household-finance:start' && !input.checkpoint.startsWith(prefix)) return next.purgeHouseholdData(input);
      const after = input.checkpoint === 'household-finance:start' ? '' : decodeURIComponent(input.checkpoint.slice(prefix.length));
      try {
        return await db.runTransaction(async tx => {
          let query = db.collection('shortcutHttpReceipts').orderBy('__name__').limit(pageSize + 1);
          if (after !== '') query = query.startAfter(after);
          const records = (await tx.get(query)).docs;
          const page = records.slice(0, pageSize);
          const updates = [];
          for (const row of page) {
            const data = row.data();
            if (typeof data.householdId === 'string') continue;
            // Rejected/unfinished receipts contain only hashes, error codes and TTL, not a transaction/member result.
            if (data.result?.kind !== 'success') continue;
            const result = data.result.transaction;
            const ids = [result?.transactionId, result?.existingTransactionId, ...(Array.isArray(result?.transactionIds) ? result.transactionIds : [])].filter((id): id is string => typeof id === 'string');
            if (ids.length === 0) throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
            const documents = await Promise.all(ids.map(id => tx.get(db.collection('expenses').doc(id))));
            const owners = new Set(documents.map(document => document.data()?.householdId).filter((owner): owner is string => typeof owner === 'string'));
            if (owners.size !== 1 || documents.some(document => !document.exists)) throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
            if (owners.has(input.householdId)) updates.push(row.ref);
          }
          for (const reference of updates) tx.set(reference, { householdId: input.householdId }, { merge: true });
          return { kind: 'page-processed' as const, nextCheckpoint: records.length > pageSize ? `${prefix}${encodeURIComponent(page.at(-1)!.id)}` : 'household-finance:0', deletedCount: 0 };
        });
      } catch (error) {
        return error instanceof Error && error.message === 'SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED'
          ? { kind: 'permanent-failure', failedCheckpoint: input.checkpoint, errorCode: error.message }
          : { kind: 'retryable-failure', retryCheckpoint: input.checkpoint, errorCode: 'SHORTCUT_RECEIPT_PREFLIGHT_UNAVAILABLE' };
      }
    },
  };
}
