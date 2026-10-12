import { act, render } from '@testing-library/react';
import { PwaNotificationNavigation } from '@/platform/pwa/PwaNotificationNavigation';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
const payload = { payloadVersion: 'notification-payload.v1', type: 'expense-created', clickTarget: 'expense-edit', expenseId: '한글/?#' };
const controller = {} as ServiceWorker;
const container = new EventTarget();
Object.assign(container, { controller });
const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
beforeEach(() => {
  mockPush.mockReset();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
});
afterAll(() => {
  if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});
function send(source: unknown = controller, data: unknown = payload) {
  const port = { postMessage: jest.fn(), close: jest.fn() };
  act(() => container.dispatchEvent(new MessageEvent('message', {
    source: source as ServiceWorker, data: { type: 'OPEN_EXPENSE_NOTIFICATION', data }, ports: [port as unknown as MessagePort],
  })));
  return port;
}
it('현재 controller의 구조화된 요청만 router로 열고 수락한다', () => {
  const view = render(<PwaNotificationNavigation />);
  const port = send();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/?' + new URLSearchParams({ edit: payload.expenseId }), { scroll: false });
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'EXPENSE_NOTIFICATION_ACCEPTED' });
  expect(port.close).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(send().postMessage).not.toHaveBeenCalled();
});
it('다른 sender와 손상된 payload는 수락하거나 탐색하지 않는다', () => {
  render(<PwaNotificationNavigation />);
  expect(send(null).postMessage).not.toHaveBeenCalled();
  expect(send({}, payload).postMessage).not.toHaveBeenCalled();
  expect(send(controller, { ...payload, clickTarget: 'https://evil.example' }).postMessage).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
