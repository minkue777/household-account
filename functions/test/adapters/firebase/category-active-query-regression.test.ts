import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { FirebaseCategoryCatalogStore } from '../../../src/adapters/firebase/categories/firebaseCategoryCatalogStore';
import { createCategoryCatalogApplication } from '../../../src/contexts/household-finance/categories-budget/application/categoryCatalogApplication';
import { InMemoryFirestore } from '../../support/in-memory-firestore';

describe('[CAT-004][T-CAT-006] 목표 category Query와 실제 Firebase read adapter', () => {
  it('빈 저장소는 NoData, 실제 transaction 실패는 RetryableFailure이며 기본 카테고리를 쓰지 않는다', async () => {
    const memory = new InMemoryFirestore();
    const application = createCategoryCatalogApplication({
      store: new FirebaseCategoryCatalogStore(memory as unknown as Firestore, {
        householdId: 'house', principalUid: 'uid', commandId: 'category-read',
        payloadFingerprint: 'read', requestedAt: '2026-09-06T00:00:00Z',
      }),
      ids: { nextCategoryId: () => { throw new Error('READ_MUST_NOT_GENERATE_ID'); }, archiveProcessId: () => { throw new Error('READ_MUST_NOT_GENERATE_ID'); } },
      referenceRemapper: {
        remapRecurringReferences: async () => { throw new Error('READ_MUST_NOT_REMAP'); },
        remapMerchantRuleReferences: async () => { throw new Error('READ_MUST_NOT_REMAP'); },
      },
    });
    expect(await application.listActive()).toEqual({ kind: 'no-data' });
    expect(memory.paths('')).toEqual([]);
    const unavailable = vi.spyOn(memory, 'runTransaction').mockRejectedValue(new Error('offline'));
    expect(await application.listActive()).toEqual({ kind: 'retryable-failure', code: 'CATEGORY_REPOSITORY_UNAVAILABLE' });
    expect(memory.paths('')).toEqual([]);
    unavailable.mockRestore();
    memory.seed('households/house/categories/custom', { name: '취미', color: '#123456', state: 'active', sortOrder: 0, version: 2 });
    expect(await application.listActive()).toMatchObject({ kind: 'success', items: [{ categoryId: 'custom', name: '취미', version: 2 }] });
    expect(memory.paths('')).toEqual(['households/house/categories/custom']);
  });
});
