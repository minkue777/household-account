import { collection, db, documentId, getDocsFromServer, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot, type DocumentData } from '@/platform/read-model/firestoreReadModel';
import { getClientSessionScope, requireClientSessionScope } from '@/composition/clientSessionScope';
import { mapDocToExpense } from '@/lib/expenseService';
import { isVisibleLedgerReadDocument } from '@/features/ledger/application/ledgerReadVisibility';
import { requestMembershipResolution } from '@/features/access-household/application/membershipResolutionRecovery';
import { requestRemoteSessionRecovery } from '@/platform/functions-api/firebaseCallableRecovery';
import type { Expense } from '@/types/expense';

const PAGE_SIZE = 500;
// Preserve the previous 50,000-document safety bound while reducing round trips.
const MAX_PAGES = 100;

/** A total is published only after the last page for the captured session. */
export async function readExpenseStatistics(startDate: string, endDate: string, options: { assertCurrent?: () => void } = {}): Promise<Expense[]> {
  if (startDate > endDate) throw new Error('STATISTICS_PERIOD_INVALID');
  const scope = { ...requireClientSessionScope() };
  const assertCurrent = () => {
    const active = getClientSessionScope();
    if (!active || active.principalUid !== scope.principalUid || active.memberId !== scope.memberId
      || active.householdId !== scope.householdId || active.sessionGeneration !== scope.sessionGeneration
      || active.accessMode !== scope.accessMode) throw new Error('STATISTICS_SESSION_CHANGED');
    options.assertCurrent?.();
  };
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  const seen = new Set<string>();
  const expenses: Expense[] = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error('STATISTICS_PAGE_LIMIT_EXCEEDED');
    assertCurrent();
    const snapshot = await getDocsFromServer(query(collection(db, 'expenses'),
      where('householdId', '==', scope.householdId), where('date', '>=', startDate), where('date', '<=', endDate),
      orderBy('date', 'asc'), orderBy(documentId(), 'asc'), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE)))
      .catch((error: unknown) => {
        assertCurrent();
        // 실시간 조회와 동일하게 인증 복구를 요청하고, 복구 epoch에서 다시 조회합니다.
        if (!requestMembershipResolution(error)) requestRemoteSessionRecovery();
        throw error;
      });
    assertCurrent();
    for (const document of snapshot.docs) {
      if (seen.has(document.id)) throw new Error('STATISTICS_CURSOR_REPEATED');
      seen.add(document.id);
      const data = document.data();
      if (!isVisibleLedgerReadDocument(data) || (data.transactionType ?? 'expense') !== 'expense') continue;
      if (!Number.isSafeInteger(data.amount) || typeof data.date !== 'string' || data.date < startDate || data.date > endDate) throw new Error('STATISTICS_SOURCE_INVALID');
      expenses.push(mapDocToExpense(document));
    }
    if (snapshot.docs.length < PAGE_SIZE) return expenses;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}
