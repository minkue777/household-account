import { expenseNotificationDestination } from '@/platform/pwa/notificationPayload';

describe('실제 worker/foreground 알림 navigation 정책', () => {
  const payload = (expenseId: string) => ({ payloadVersion: 'notification-payload.v1', type: 'expense-created', clickTarget: 'expense-edit', expenseId });
  it.each(['/', '?', '#', '한글 거래', 'expense-A.1'])('식별자 %s를 정확히 한 segment로 인코딩한다', id => {
    expect(expenseNotificationDestination(payload(id), 'https://example.com'))
      .toBe('https://example.com/expenses/' + encodeURIComponent(id) + '/edit');
  });
  it.each(['.', '..', '%2e', '%252f', '\\admin', '', '\u0000bad'])('traversal/잘못된 식별자 %s를 거부한다', id => {
    expect(expenseNotificationDestination(payload(id), 'https://example.com')).toBeNull();
  });
  it('알 수 없는 version/route를 거부한다', () => {
    expect(expenseNotificationDestination({ ...payload('id'), payloadVersion: 'v2' }, 'https://example.com')).toBeNull();
    expect(expenseNotificationDestination({ ...payload('id'), clickTarget: 'https://evil.com' }, 'https://example.com')).toBeNull();
  });
});
