import {
  OperationDeadlineExceededError,
  withinDeadline,
} from '@/platform/network/operationDeadline';

describe('비동기 작업 deadline 계약', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('deadline 전에 완료된 결과를 그대로 반환한다', async () => {
    await expect(withinDeadline(Promise.resolve('ready'), 1_000, 'TIMEOUT'))
      .resolves.toBe('ready');
  });

  it('[T-WEBVIEW-004][AND-012] 캐시 없는 최초 가계부 read는 20초 무응답을 안정적인 오류 코드로 종료한다', async () => {
    jest.useFakeTimers();
    const result = withinDeadline(new Promise<never>(() => {}), 20_000, 'HOUSEHOLD_READ_TIMEOUT');

    jest.advanceTimersByTime(20_000);

    await expect(result).rejects.toEqual(
      new OperationDeadlineExceededError('HOUSEHOLD_READ_TIMEOUT')
    );
  });
});
