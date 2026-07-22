import {
  HouseholdQueryClient,
  HouseholdQueryError,
  type HouseholdQueryTransport,
} from '@/platform/functions-api/householdQueryClient';
import type {
  HouseholdQueryEnvelope,
  HouseholdQueryName,
  HouseholdQueryOutcome,
  HouseholdQueryResults,
} from '@/platform/functions-api/householdQueryContract';

describe('Household Query Client 계약', () => {
  it('현재 인증 세션의 householdId만 조회 envelope에 사용한다', async () => {
    let captured: HouseholdQueryEnvelope | undefined;
    const transport: HouseholdQueryTransport = {
      async send<Name extends HouseholdQueryName>(envelope: HouseholdQueryEnvelope<Name>) {
        captured = envelope;
        return {
          kind: 'succeeded',
          value: { kind: 'notFound' },
        } as HouseholdQueryOutcome<HouseholdQueryResults[Name]>;
      },
    };
    const client = new HouseholdQueryClient(transport, () => 'household-session');

    await expect(
      client.execute('shortcut.get-credential-status.v1', {})
    ).resolves.toEqual({ kind: 'notFound' });
    expect(captured).toMatchObject({
      contractVersion: 'household-query.v1',
      householdId: 'household-session',
      query: 'shortcut.get-credential-status.v1',
      payload: {},
    });
  });

  it('세션 가구가 없으면 transport를 호출하지 않는다', async () => {
    const send = jest.fn();
    const client = new HouseholdQueryClient({ send }, () => undefined);

    await expect(
      client.execute('shortcut.get-credential-status.v1', {})
    ).rejects.toMatchObject({ code: 'HOUSEHOLD_ID_REQUIRED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('서버의 typed rejection을 retryable 정보와 함께 전달한다', async () => {
    const client = new HouseholdQueryClient(
      {
        async send() {
          return {
            kind: 'rejected',
            error: { code: 'QUERY_UNAVAILABLE', retryable: true },
          };
        },
      },
      () => 'household-session'
    );

    await expect(
      client.execute('shortcut.get-credential-status.v1', {})
    ).rejects.toEqual(new HouseholdQueryError('QUERY_UNAVAILABLE', true));
  });

});
