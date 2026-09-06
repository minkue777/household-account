import { act, fireEvent, render, screen } from '@testing-library/react';
import { PwaRuntimeUpdate } from '@/platform/pwa/PwaRuntimeUpdate';

const mockConfirm = jest.fn(async () => false);
const mockReload = jest.fn();
const mockWorker = { postMessage: jest.fn((message, ports) => {
  if (message.type === 'GET_WORKER_VERSION') ports[0].reply({ type: 'UPDATE_AVAILABLE', workerVersion: 'build-2' });
}) };
const mockRegistration = Object.assign(new EventTarget(), { waiting: mockWorker, update: jest.fn(async () => {}) });
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showConfirm: mockConfirm }) }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({ isAndroidHostAvailable: () => false }));
jest.mock('@/platform/performance/webStartupPerformance', () => ({ scheduleAfterWebFirstLedgerPaint: (callback: () => void) => { queueMicrotask(callback); return () => {}; } }));
jest.mock('@/platform/pwa/browserServiceWorker', () => ({ ensurePwaServiceWorker: async () => mockRegistration, reloadPwaWindow: () => mockReload() }));

describe('실제 PWA 업데이트 React composition', () => {
  let container: EventTarget & { controller?: unknown };
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(false);
    container = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: class {
      port1 = { onmessage: undefined as any, close() {} };
      port2 = { reply: (data: unknown) => this.port1.onmessage?.({ data }) };
    } });
  });
  it('waiting 발견과 다른 탭 활성화는 자동 reload하지 않고 선택한 전환만 한 번 reload한다', async () => {
    render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    act(() => container.dispatchEvent(new Event('controllerchange')));
    expect(mockReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('갱신'));
    expect(mockWorker.postMessage).toHaveBeenLastCalledWith({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: 'build-2' });
    container.controller = mockWorker;
    act(() => { container.dispatchEvent(new Event('controllerchange')); container.dispatchEvent(new Event('controllerchange')); });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
  it('미저장 입력은 보존하고 명시적으로 폐기한 경우만 활성화를 요청한다', async () => {
    render(<><PwaRuntimeUpdate /><input aria-label="금액" defaultValue="100" /></>);
    const input = screen.getByLabelText('금액');
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: '250' } });
    await screen.findByText('갱신');
    await act(async () => { fireEvent.click(screen.getByText('갱신')); });
    expect(input).toHaveValue('250');
    expect(mockWorker.postMessage.mock.calls.filter(([message]) => message.type === 'ACTIVATE_WAITING_WORKER')).toHaveLength(0);
    mockConfirm.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.click(screen.getByText('갱신')); });
    expect(mockWorker.postMessage).toHaveBeenLastCalledWith({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: 'build-2' });
  });
});
