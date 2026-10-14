import { act, fireEvent, render, screen } from '@testing-library/react';
import { PwaRuntimeUpdate } from '@/platform/pwa/PwaRuntimeUpdate';

const mockConfirm = jest.fn(async () => false);
const mockReload = jest.fn();
function mockCreateWorker(version = 'build-2') {
  return Object.assign(new EventTarget(), {
    state: 'installed' as ServiceWorkerState,
    postMessage: jest.fn((message, ports?) => {
      if (message.type === 'GET_WORKER_VERSION') ports[0].reply({ type: 'UPDATE_AVAILABLE', workerVersion: version });
    }),
  });
}
let mockWorker = mockCreateWorker();
let mockRegistration = Object.assign(new EventTarget(), {
  waiting: mockWorker, installing: undefined as ReturnType<typeof mockCreateWorker> | undefined,
  update: jest.fn(async () => {}),
});
jest.mock('@/contexts/AppDialogContext', () => ({ useAppDialog: () => ({ showConfirm: mockConfirm }) }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({ isAndroidHostAvailable: () => false }));
jest.mock('@/platform/performance/webStartupPerformance', () => ({ scheduleAfterWebFirstLedgerPaint: (callback: () => void) => { queueMicrotask(callback); return () => {}; } }));
jest.mock('@/platform/pwa/browserServiceWorker', () => ({ ensurePwaServiceWorker: async () => mockRegistration, reloadPwaWindow: () => mockReload() }));

describe('실제 PWA 업데이트 React composition', () => {
  let container: EventTarget & { controller?: unknown };
  const activationMessages = () => mockWorker.postMessage.mock.calls.filter(([message]) => message.type === 'ACTIVATE_WAITING_WORKER');
  const complete = (worker = mockWorker) => act(() => {
    worker.state = 'activated';
    container.controller = worker;
    worker.dispatchEvent(new Event('statechange'));
    container.dispatchEvent(new Event('controllerchange'));
  });
  const changeInput = (value: string) => {
    const input = screen.getByLabelText('금액');
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value } });
    return input;
  };
  const clickUpdate = async () => act(async () => { fireEvent.click(screen.getByRole('button', { name: '갱신' })); });
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(false);
    mockWorker = mockCreateWorker();
    mockRegistration = Object.assign(new EventTarget(), { waiting: mockWorker, installing: undefined, update: jest.fn(async () => {}) });
    container = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: class {
      port1 = { onmessage: undefined as any, close() {} };
      port2 = { reply: (data: unknown) => this.port1.onmessage?.({ data }) };
    } });
  });
  afterEach(() => jest.useRealTimers());

  it('waiting과 다른 controller는 자동 reload하지 않고 요청한 활성화만 한 번 reload한다', async () => {
    render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    act(() => container.dispatchEvent(new Event('controllerchange')));
    expect(mockReload).not.toHaveBeenCalled();
    await clickUpdate();
    expect(activationMessages()).toEqual([[{ type: 'ACTIVATE_WAITING_WORKER', workerVersion: 'build-2' }]]);
    complete(mockCreateWorker('other-build'));
    expect(mockReload).not.toHaveBeenCalled();
    complete();
    act(() => container.dispatchEvent(new Event('controllerchange')));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('교체 지연은 갱신 중으로 표시하며 반복 클릭이나 시간 경과로 재전송·reload하지 않는다', async () => {
    render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    jest.useFakeTimers();
    await clickUpdate();
    const button = screen.getByRole('button', { name: '갱신 중…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    act(() => jest.advanceTimersByTime(60_000));
    expect(activationMessages()).toHaveLength(1);
    expect(mockReload).not.toHaveBeenCalled();
    complete();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('controller가 먼저 바뀌어도 worker가 activated가 될 때까지 reload하지 않는다', async () => {
    render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    await clickUpdate();
    act(() => {
      mockWorker.state = 'activating';
      container.controller = mockWorker;
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(mockReload).not.toHaveBeenCalled();
    act(() => {
      mockWorker.state = 'activated';
      mockWorker.dispatchEvent(new Event('statechange'));
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('worker가 먼저 activated가 되어도 해당 controller로 바뀔 때까지 reload하지 않는다', async () => {
    render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    container.controller = mockCreateWorker('old-build');
    await clickUpdate();
    act(() => {
      mockWorker.state = 'activated';
      mockWorker.dispatchEvent(new Event('statechange'));
    });
    expect(mockReload).not.toHaveBeenCalled();
    act(() => {
      container.controller = mockWorker;
      container.dispatchEvent(new Event('controllerchange'));
      mockWorker.dispatchEvent(new Event('statechange'));
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('미저장 입력은 취소하면 보존하고 폐기 승인한 그대로라면 활성화 후 reload한다', async () => {
    render(<><PwaRuntimeUpdate /><input aria-label="금액" defaultValue="100" /></>);
    const input = changeInput('250');
    await screen.findByText('갱신');
    await clickUpdate();
    expect(input).toHaveValue('250');
    expect(activationMessages()).toHaveLength(0);
    mockConfirm.mockResolvedValueOnce(true);
    await clickUpdate();
    complete();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('승인 후 새로 수정한 입력은 늦게 활성화되어도 보존한다 (기존 초안 %s)', async existingDraft => {
    render(<><PwaRuntimeUpdate /><input aria-label="금액" defaultValue="100" /></>);
    if (existingDraft) changeInput('250');
    await screen.findByText('갱신');
    if (existingDraft) mockConfirm.mockResolvedValueOnce(true);
    await clickUpdate();
    mockConfirm.mockResolvedValue(false);
    const input = changeInput('400');
    complete();
    expect(mockReload).not.toHaveBeenCalled();
    expect(input).toHaveValue('400');
    expect(screen.getByText('새 버전을 적용할 수 있습니다.')).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })); });
    expect(mockReload).not.toHaveBeenCalled();
    expect(input).toHaveValue('400');
    mockConfirm.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '적용' })); });
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(activationMessages()).toHaveLength(1);
  });

  it('적용 확인 도중 다른 worker로 바뀌면 앞선 승인을 새 controller에 넘기지 않는다', async () => {
    render(<><PwaRuntimeUpdate /><input aria-label="금액" defaultValue="100" /></>);
    await screen.findByText('갱신');
    await clickUpdate();
    changeInput('400');
    complete();
    let resolve!: (value: boolean) => void;
    mockConfirm.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    complete(mockCreateWorker('other-build'));
    await act(async () => { resolve(true); });
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeEnabled();
  });

  it('폐기 확인 중 중복 클릭은 한 번만 확인하고 한 번만 활성화한다', async () => {
    render(<><PwaRuntimeUpdate /><input aria-label="금액" defaultValue="100" /></>);
    changeInput('250');
    await screen.findByText('갱신');
    let resolve!: (value: boolean) => void;
    mockConfirm.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    fireEvent.click(screen.getByText('갱신'));
    fireEvent.click(screen.getByText('갱신'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(true); });
    expect(activationMessages()).toHaveLength(1);
  });

  it.each(['postMessage', 'redundant'])('활성화 실패 %s 뒤에는 새 후보를 다시 확인할 수 있다', async failure => {
    render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    if (failure === 'postMessage') mockWorker.postMessage.mockImplementationOnce(() => { throw new Error('worker terminated'); });
    await clickUpdate();
    if (failure === 'redundant') act(() => {
      mockWorker.state = 'redundant';
      mockWorker.dispatchEvent(new Event('statechange'));
    });
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '갱신 중…' })).not.toBeInTheDocument();
    const nextWorker = mockCreateWorker('build-3');
    mockRegistration.waiting = nextWorker;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 확인' })); });
    await clickUpdate();
    expect(nextWorker.postMessage).toHaveBeenLastCalledWith({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: 'build-3' });
    complete(nextWorker);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('unmount 뒤 늦은 폐기 승인이나 worker 이벤트는 활성화·reload하지 않는다', async () => {
    const view = render(<><PwaRuntimeUpdate /><input aria-label="금액" defaultValue="100" /></>);
    changeInput('250');
    await screen.findByText('갱신');
    let resolve!: (value: boolean) => void;
    mockConfirm.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    fireEvent.click(screen.getByText('갱신'));
    view.unmount();
    await act(async () => { resolve(true); });
    complete();
    expect(activationMessages()).toHaveLength(0);
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('unmount는 요청한 worker와 설치 중 worker의 상태 listener를 제거한다', async () => {
    const view = render(<PwaRuntimeUpdate />);
    await screen.findByText('갱신');
    const removeRequested = jest.spyOn(mockWorker, 'removeEventListener');
    const installing = mockCreateWorker('build-3');
    const removeInstalling = jest.spyOn(installing, 'removeEventListener');
    mockRegistration.installing = installing;
    act(() => mockRegistration.dispatchEvent(new Event('updatefound')));
    await clickUpdate();
    view.unmount();
    expect(removeRequested).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(removeInstalling).toHaveBeenCalledWith('statechange', expect.any(Function));
    complete();
    expect(mockReload).not.toHaveBeenCalled();
  });
});
