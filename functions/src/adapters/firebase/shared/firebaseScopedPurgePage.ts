import type { CollectionReference, DocumentReference, Firestore, Query } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import type { HouseholdPurgeParticipantPort } from '../../../contexts/access/household-purge-process/application/ports/out/householdPurgeProcessPorts';

/** 루트 query로 소유 가구를 확정한 뒤 하위 leaf부터 제거합니다. 부모 선삭제로 orphan을 만들지 않습니다. */
async function firstLeaf(reference: DocumentReference): Promise<DocumentReference> {
  for (const collection of await reference.listCollections()) {
    const child = (await collection.orderBy(FieldPath.documentId()).limit(1).get()).docs[0];
    if (child) return firstLeaf(child.ref);
    // Normal queries omit missing ancestors. Metadata-only fallback is used only
    // after all existing children are gone; the canonical parent path owns these descendants.
    const orphan = (await collection.listDocuments())[0];
    if (orphan) return firstLeaf(orphan);
  }
  return reference;
}

export function firebaseScopedPurgeParticipant(db: Firestore, roots: (householdId: string) => Promise<readonly Query[]> , pageSize = 100): HouseholdPurgeParticipantPort {
  return {
    async purgeHouseholdData(input) {
      const collections = await roots(input.householdId);
      const prefix = `${input.participant}:`;
      if (!input.checkpoint.startsWith(prefix)) return { kind: 'permanent-failure', failedCheckpoint: input.checkpoint, errorCode: 'INVALID_PURGE_CHECKPOINT' };
      let index = input.checkpoint === `${prefix}start` ? 0 : Number(input.checkpoint.slice(prefix.length));
      if (!Number.isSafeInteger(index) || index < 0 || index > collections.length) return { kind: 'permanent-failure', failedCheckpoint: input.checkpoint, errorCode: 'INVALID_PURGE_CHECKPOINT' };
      let deletedCount = 0;
      try {
        while (index < collections.length && deletedCount < pageSize) {
          const collection = collections[index];
          const head = (await collection.orderBy(FieldPath.documentId()).limit(1).get()).docs[0];
          // Only unfiltered canonical collections may infer ownership from a missing ancestor path.
          const reference = head?.ref ?? ('listDocuments' in collection ? (await (collection as CollectionReference).listDocuments())[0] : undefined);
          if (!reference) { index += 1; continue; }
          const leaf = await firstLeaf(reference);
          await leaf.delete();
          deletedCount += 1;
        }
      } catch {
        return { kind: 'retryable-failure', retryCheckpoint: input.checkpoint, errorCode: 'SCOPED_PURGE_UNAVAILABLE' };
      }
      return index === collections.length
        ? { kind: 'purge-completed', finalCheckpoint: `${prefix}${index}`, deletedCount }
        : { kind: 'page-processed', nextCheckpoint: `${prefix}${index}`, deletedCount };
    },
  };
}

export function scopedCollections(db: Firestore, householdId: string, names: readonly string[]): Query[] {
  return names.map(name => db.collection(name).where('householdId', '==', householdId));
}

export async function remainingHouseholdCollections(db: Firestore, householdId: string, processId: string): Promise<readonly CollectionReference[]> {
  const process = db.collection('householdPurgeProcesses').doc(processId);
  const discovered = (await db.collection('households').doc(householdId).listCollections()).map(item => item.id).sort();
  const names = await db.runTransaction(async tx => {
    const current = (await tx.get(process)).data();
    if (Array.isArray(current?.accessCollectionNames)) return current.accessCollectionNames as string[];
    tx.update(process, { accessCollectionNames: discovered });
    return discovered;
  });
  return names.map(name => db.collection('households').doc(householdId).collection(name));
}
