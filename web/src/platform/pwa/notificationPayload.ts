export interface ExpenseNotificationData {
  payloadVersion: 'notification-payload.v1';
  type: 'expense-created' | 'household-notification-requested';
  clickTarget: 'expense-edit';
  expenseId: string;
}

export function expenseNotificationData(value: unknown): ExpenseNotificationData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.payloadVersion !== 'notification-payload.v1'
    || data.clickTarget !== 'expense-edit'
    || !['expense-created', 'household-notification-requested'].includes(String(data.type))
    || typeof data.expenseId !== 'string' || !data.expenseId.trim()
    || data.expenseId.length > 256 || /[%\\\u0000-\u001f\u007f]/.test(data.expenseId)
    || data.expenseId === '.' || data.expenseId === '..') return null;
  return {
    payloadVersion: 'notification-payload.v1', type: data.type as ExpenseNotificationData['type'],
    clickTarget: 'expense-edit', expenseId: data.expenseId,
  };
}

export function expenseNotificationDestination(value: unknown, origin: string): string | null {
  const data = expenseNotificationData(value);
  if (!data) return null;
  try {
    const url = new URL(`/expenses/${encodeURIComponent(data.expenseId)}/edit`, origin);
    const segments = url.pathname.split('/');
    if (url.origin !== origin || segments.length !== 4 || segments[1] !== 'expenses'
      || segments[3] !== 'edit' || !segments[2]
      || decodeURIComponent(segments[2]) !== data.expenseId || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}
