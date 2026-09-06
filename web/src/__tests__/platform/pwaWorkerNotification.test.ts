import { onBackgroundMessage } from 'firebase/messaging/sw';

jest.mock('firebase/app', () => ({ initializeApp: jest.fn(() => ({})) }));
jest.mock('firebase/messaging/sw', () => ({ getMessaging: jest.fn(() => ({})), onBackgroundMessage: jest.fn() }));
jest.mock('@/platform/firebase/firebasePublicConfig', () => ({ firebaseConfig: {} }));

const payload = (expenseId: string) => ({ payloadVersion: 'notification-payload.v1', type: 'expense-created', clickTarget: 'expense-edit', expenseId });
const handlers = new Map<string, (event: any) => void>();
const navigate = jest.fn();
const focus = jest.fn();
const openWindow = jest.fn();
const matchAll = jest.fn();
const showNotification = jest.fn();

beforeAll(() => {
  const listener = jest.spyOn(self, 'addEventListener').mockImplementation((type: string, handler: any) => { handlers.set(type, handler); });
  Object.defineProperty(self, 'clients', { configurable: true, value: { matchAll, openWindow } });
  Object.defineProperty(self, 'registration', { configurable: true, value: { showNotification } });
  // Load the same entry bundled into the production service worker, preserving its handlers.
  require('../../../worker/index.js');
  listener.mockRestore();
});
beforeEach(() => {
  navigate.mockReset().mockResolvedValue(undefined);
  focus.mockReset().mockResolvedValue(undefined);
  openWindow.mockReset().mockResolvedValue(undefined);
  showNotification.mockReset().mockResolvedValue(undefined);
  matchAll.mockReset().mockResolvedValue([
    { url: 'https://other.example/expenses/old/edit', navigate: jest.fn(), focus: jest.fn() },
    { url: self.location.origin + '/stats', navigate, focus },
  ]);
});

async function click(data: unknown, action = '') {
  let pending: Promise<unknown> | undefined;
  const event = {
    action, notification: { data, close: jest.fn() }, stopImmediatePropagation: jest.fn(),
    waitUntil: jest.fn((work: Promise<unknown>) => { pending = work; }),
  };
  handlers.get('notificationclick')!(event);
  await pending;
  expect(event.notification.close).toHaveBeenCalledTimes(1);
  expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  return event;
}

it.each(['/', '?', '#', '한글 거래', 'expense-A.1'])('PWA-006 actual click handler keeps %s in a single expense path segment', async id => {
  await click({ FCM_MSG: { data: payload(id) } });
  expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  expect(navigate).toHaveBeenCalledWith(self.location.origin + '/expenses/' + encodeURIComponent(id) + '/edit');
  expect(focus).toHaveBeenCalledTimes(1);
  expect(openWindow).not.toHaveBeenCalled();
});

it.each(['.', '..', '%2e', '%252f', '\\admin', '', '\u0000bad'])('actual click handler rejects traversal and ambiguous encoding: %s', async id => {
  const event = await click(payload(id));
  expect(event.waitUntil).not.toHaveBeenCalled();
  expect(matchAll).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
});

it('rejects unknown versions, external click targets and dismiss actions without navigation', async () => {
  await click({ ...payload('a'), payloadVersion: 'v2' });
  await click({ ...payload('a'), clickTarget: 'https://other.example/' });
  await click(payload('a'), 'dismiss');
  expect(matchAll).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
});

it('opens the structured expense edit route when no same-origin window exists', async () => {
  matchAll.mockResolvedValue([{ url: 'https://other.example/', navigate, focus }]);
  await click(payload('한글/거래'));
  expect(openWindow).toHaveBeenCalledWith(self.location.origin + '/expenses/' + encodeURIComponent('한글/거래') + '/edit');
  expect(navigate).not.toHaveBeenCalled();
});

it('blocks malformed push data before Firebase and displays a valid data-only message once', async () => {
  const malformed = { data: { json: () => { throw new Error('invalid JSON'); } }, stopImmediatePropagation: jest.fn() };
  handlers.get('push')!(malformed);
  expect(malformed.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  const background = jest.mocked(onBackgroundMessage).mock.calls[0][1] as (message: any) => Promise<void> | void;
  await background({ data: payload('a') });
  expect(showNotification).toHaveBeenCalledTimes(1);
  expect(showNotification).toHaveBeenCalledWith('가계부 알림', expect.objectContaining({ data: payload('a') }));
  await background({ data: payload('a'), notification: { title: 'SDK 표시' } });
  await background({ data: payload('%252f') });
  expect(showNotification).toHaveBeenCalledTimes(1);
});
