import type { Firestore } from 'firebase-admin/firestore';
import type { HouseholdPurgeParticipantPort } from '../../../contexts/access/household-purge-process/application/ports/out/householdPurgeProcessPorts';

/** Resolve old HTTP receipts before the canonical ledger is purged. */
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
          const households = (await tx.get(db.collection('households'))).docs;
          const updates = [];
          for (const row of page) {
            const data = row.data();
            if (typeof data.householdId === 'string') continue;
            // Rejected/unfinished receipts contain only hashes, error codes and TTL, not a transaction/member result.
            if (data.result?.kind !== 'success') continue;
            const result = data.result.transaction;
            const ids = [...new Set([result?.transactionId, result?.existingTransactionId, ...(Array.isArray(result?.transactionIds) ? result.transactionIds : [])].filter((id): id is string => typeof id === 'string'))];
            if (ids.length === 0) throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
            const owners = new Set(await Promise.all(ids.map(async id => {
              if (households.length === 0 || id === '' || id.includes('/')) throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
              const documents = await tx.getAll(...households.map(household => household.ref.collection('ledgerTransactions').doc(id)));
              const matches = documents.filter(document => document.exists);
              // IDs are household-scoped. Never guess an owner when two households
              // use the same ID or a document's scope disagrees with its path. Older
              // canonical documents may omit transactionId; the document ID remains authoritative.
              if (matches.length !== 1) throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
              const document = matches[0];
              const ledger = document.data()!;
              const owner = ledger.householdId;
              if (typeof owner !== 'string' || owner === ''
                || (ledger.transactionId !== undefined && ledger.transactionId !== id)
                || document.ref.path !== `households/${owner}/ledgerTransactions/${id}`) {
                throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
              }
              return owner;
            })));
            if (owners.size !== 1) throw new Error('SHORTCUT_RECEIPT_OWNERSHIP_UNRESOLVED');
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
