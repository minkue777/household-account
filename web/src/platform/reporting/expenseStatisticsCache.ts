import { getClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';
import type { Expense } from '@/types/expense';
import { readExpenseStatistics } from './expenseStatisticsReadModel';
import { expenseStatisticsActorKey, getExpenseStatisticsRevision, invalidateExpenseStatistics, subscribeExpenseStatisticsInvalidation } from './expenseStatisticsInvalidation';

const MAX_AGE_MS = 60_000;
const MAX_COMPLETED_RANGES = 4;
export interface ExpenseStatisticsQuery {
  scope: ClientSessionScope;
  remoteReadEpoch: number;
  revision: number;
  startDate: string;
  endDate: string;
}
interface CompletedRange {
  identity: string;
  startDate: string;
  endDate: string;
  expenses: Expense[];
  receivedAt: number;
}
interface PendingRange {
  identity: string;
  startDate: string;
  endDate: string;
  obsolete: boolean;
  promise: Promise<Expense[]>;
}
let completed: CompletedRange[] = [];
const pending = new Set<PendingRange>();
let generation = 0;
let activeIdentity: string | undefined;

function identity(query: ExpenseStatisticsQuery): string {
  return JSON.stringify([expenseStatisticsActorKey(query.scope), query.remoteReadEpoch, query.revision]);
}
function current(query: ExpenseStatisticsQuery): boolean {
  return expenseStatisticsActorKey(query.scope) === expenseStatisticsActorKey(getClientSessionScope())
    && query.revision === getExpenseStatisticsRevision();
}
function covers(range: { startDate: string; endDate: string }, query: ExpenseStatisticsQuery): boolean {
  return range.startDate <= query.startDate && range.endDate >= query.endDate;
}
function overlaps(left: { startDate: string; endDate: string }, right: { startDate: string; endDate: string }): boolean {
  return left.startDate <= right.endDate && left.endDate >= right.startDate;
}
function select(expenses: Expense[], query: ExpenseStatisticsQuery): Expense[] {
  return expenses.filter(expense => expense.date >= query.startDate && expense.date <= query.endDate);
}
function findCompleted(query: ExpenseStatisticsQuery): CompletedRange | undefined {
  if (!current(query)) return undefined;
  return completed.find(range => range.identity === identity(query) && covers(range, query));
}

/** Only a fully completed, identical actor/revision range is eligible for immediate display. */
export function peekExpenseStatistics(query: ExpenseStatisticsQuery): Expense[] | undefined {
  const cached = findCompleted(query);
  return cached ? select(cached.expenses, query) : undefined;
}

export async function loadExpenseStatistics(query: ExpenseStatisticsQuery, force = false): Promise<Expense[]> {
  if (!current(query)) throw new Error('STATISTICS_SESSION_CHANGED');
  const key = identity(query);
  if (activeIdentity !== key) {
    generation += 1;
    completed = [];
    pending.clear();
    activeIdentity = key;
  }
  const cached = findCompleted(query);
  const existing = Array.from(pending).find(range => !range.obsolete && range.identity === key && covers(range, query));
  if (existing) return select(await existing.promise, query);
  if (!force && cached && Date.now() - cached.receivedAt < MAX_AGE_MS) return select(cached.expenses, query);

  // Refresh the covering source, retaining instant 3/6/12-month reuse after resume.
  const startDate = cached?.startDate ?? query.startDate;
  const endDate = cached?.endDate ?? query.endDate;
  // A newer overlapping query owns the source. A late older range must not evict it.
  for (const range of Array.from(pending)) {
    if (range.identity === key && overlaps(range, { startDate, endDate })) range.obsolete = true;
  }
  const capturedGeneration = generation;
  const request = { identity: key, startDate, endDate, obsolete: false } as PendingRange;
  const assertCurrent = () => {
    if (request.obsolete || capturedGeneration !== generation || !current(query)) throw new Error('STATISTICS_SESSION_CHANGED');
  };
  request.promise = readExpenseStatistics(startDate, endDate, { assertCurrent }).then(expenses => {
    assertCurrent();
    // Replace overlapping sources so a refreshed subset cannot leave a newer-looking stale total.
    completed = completed.filter(range => range.identity !== key || range.endDate < startDate || range.startDate > endDate);
    completed.unshift({ identity: key, startDate, endDate, expenses, receivedAt: Date.now() });
    completed = completed.slice(0, MAX_COMPLETED_RANGES);
    return expenses;
  }).finally(() => { pending.delete(request); });
  pending.add(request);
  return select(await request.promise, query);
}

subscribeExpenseStatisticsInvalidation(() => {
  generation += 1;
  activeIdentity = undefined;
  completed = [];
  pending.clear();
});
registerClientSessionReset(invalidateExpenseStatistics);
