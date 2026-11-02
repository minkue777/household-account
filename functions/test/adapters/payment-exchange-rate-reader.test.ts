import { describe, expect, it, vi } from 'vitest';
import { PaymentExchangeRateReader } from '../../src/adapters/http/paymentExchangeRateReader';
import type { SafeExternalTextHttpInputPort } from '../../src/platform/external-operations/application/ports/in/safeExternalTextHttpInputPort';

function response(data: unknown) { return {kind:'success' as const, body:JSON.stringify(data), finalUrl:'https://api.frankfurter.dev',responseBytes:80,attempts:1}; }
describe('결제일의 ECB 엔화 고시 환율', () => {
  it('휴일의 직전 고시일을 보존하고 날짜별 캐시를 분리한다', async () => {
    const execute = vi.fn<SafeExternalTextHttpInputPort['execute']>().mockResolvedValue(response({base:'JPY',quote:'KRW',date:'2026-10-30',rate:8.5}));
    const reader = new PaymentExchangeRateReader({execute});
    expect(await reader.getYenRate('2026-11-01')).toEqual({rateInWon:8.5,rateDate:'2026-10-30',provider:'frankfurter-ecb'});
    await reader.getYenRate('2026-11-01');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].url).toBe('https://api.frankfurter.dev/v2/rate/JPY/KRW?date=2026-11-01&providers=ECB');
    await reader.getYenRate('2026-10-30');
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it.each([{base:'USD'}, {quote:'JPY'}, {date:'2026-11-03'}, {date:'2026-02-30'}, {rate:0}, {rate:-1}, {rate:'8.5'}])('잘못된 공급자 응답을 환율로 사용하지 않는다: %j', async override => {
    const execute = vi.fn<SafeExternalTextHttpInputPort['execute']>().mockResolvedValue(response({base:'JPY',quote:'KRW',date:'2026-10-30',rate:8.5,...override}));
    expect(await new PaymentExchangeRateReader({execute}).getYenRate('2026-11-01')).toBeUndefined();
  });
  it('시간 초과는 고정값으로 대체하거나 성공 캐시로 남기지 않는다', async () => {
    const execute = vi.fn<SafeExternalTextHttpInputPort['execute']>()
      .mockResolvedValueOnce({kind:'retryable-failure',code:'TIMEOUT',attempts:1})
      .mockResolvedValue(response({base:'JPY',quote:'KRW',date:'2026-10-30',rate:8.5}));
    const reader=new PaymentExchangeRateReader({execute});
    expect(await reader.getYenRate('2026-10-30')).toBeUndefined();
    expect(await reader.getYenRate('2026-10-30')).toMatchObject({rateInWon:8.5});
  });
});
