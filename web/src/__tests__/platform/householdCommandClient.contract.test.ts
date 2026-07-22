import {
  HouseholdCommandClient,
  HouseholdCommandError,
  type HouseholdCommandTransport,
} from '@/platform/functions-api/householdCommandClient';
import {
  parseHouseholdCommandWireResponse,
  type HouseholdCommandEnvelope,
  type HouseholdCommandName,
  type HouseholdCommandOutcome,
  type HouseholdCommandResults,
} from '@/platform/functions-api/householdCommandContract';

function transportReturning(result: HouseholdCommandOutcome<unknown>) {
  const send = jest.fn(async () => result) as unknown as jest.MockedFunction<HouseholdCommandTransport['send']>;
  return { send } as HouseholdCommandTransport & { send: typeof send };
}

describe('Web Household Command 계약', () => {
  test('tenant command의 householdId는 현재 인증 세션에서만 결정한다', async () => {
    const transport = transportReturning({ kind: 'succeeded', value: {} });
    const client = new HouseholdCommandClient(transport, () => 'household-session');

    await client.execute(
      'category.archive.v1',
      { categoryId: 'category-1' },
      { householdId: 'household-session', commandId: 'cmd-1' }
    );

    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      contractVersion: 'household-command.v1',
      commandId: 'cmd-1',
      idempotencyKey: 'cmd-1',
      householdId: 'household-session',
      command: 'category.archive.v1',
    }));
  });

  test('명시한 householdId가 세션과 다르면 전송 전에 거부한다', async () => {
    const transport = transportReturning({ kind: 'succeeded', value: {} });
    const client = new HouseholdCommandClient(transport, () => 'household-session');

    await expect(client.execute(
      'category.archive.v1',
      { categoryId: 'category-1' },
      { householdId: 'other-household' }
    )).rejects.toMatchObject({ code: 'HOUSEHOLD_SCOPE_MISMATCH' });
    expect(transport.send).not.toHaveBeenCalled();
  });

  test('관리자 조회 전용 세션은 tenant 변경 명령을 전송 전에 거부한다', async () => {
    const transport = transportReturning({ kind: 'succeeded', value: {} });
    const client = new HouseholdCommandClient(
      transport,
      () => 'observed-household',
      () => 'administrator-readonly'
    );

    await expect(client.execute(
      'ledger.delete-transaction.v1',
      { transactionId: 'expense-1', expectedVersion: 1 }
    )).rejects.toMatchObject({ code: 'ADMIN_VIEW_READ_ONLY' });
    expect(transport.send).not.toHaveBeenCalled();
  });

  test('principal scope 명령에는 client householdId를 싣지 않는다', async () => {
    const resolution = { kind: 'first-visit-required' as const, choices: ['create' as const, 'join' as const] };
    const transport = transportReturning({ kind: 'succeeded', value: resolution });
    const client = new HouseholdCommandClient(transport, () => 'household-session');

    await client.execute(
      'access.resolve-signed-in-user.v1',
      {},
      { householdId: 'attacker-supplied', commandId: 'resolve-1' }
    );

    const envelope = (transport.send as jest.Mock).mock.calls[0][0] as HouseholdCommandEnvelope;
    expect(envelope).not.toHaveProperty('householdId');
  });

  test('already-processed는 최초 성공과 같은 value를 반환한다', async () => {
    const transport = transportReturning({
      kind: 'already-processed',
      value: { categoryId: 'category-existing' },
    });
    const client = new HouseholdCommandClient(transport, () => 'household-1');

    await expect(client.execute(
      'category.create.v1',
      { category: { label: '식비' } },
      { commandId: 'same-command' }
    )).resolves.toEqual({ categoryId: 'category-existing' });
  });

  test('typed rejection은 retryable 정보를 보존한다', async () => {
    const transport = transportReturning({
      kind: 'rejected',
      error: { code: 'VERSION_MISMATCH', retryable: false },
    });
    const client = new HouseholdCommandClient(transport, () => 'household-1');

    const promise = client.execute(
      'ledger.delete-transaction.v1',
      { transactionId: 'expense-1', expectedVersion: 4 }
    );
    await expect(promise).rejects.toBeInstanceOf(HouseholdCommandError);
    await expect(promise).rejects.toMatchObject({ code: 'VERSION_MISMATCH', retryable: false });
  });
});

describe('Functions wire 응답 파서', () => {
  test('계약 버전과 commandId가 모두 일치해야 한다', () => {
    expect(() => parseHouseholdCommandWireResponse(
      {
        contractVersion: 'household-command-response.v1',
        commandId: 'different-command',
        result: { kind: 'succeeded', value: {} },
      },
      'expected-command'
    )).toThrow(/commandId/);

    expect(() => parseHouseholdCommandWireResponse(
      {
        contractVersion: 'old-response.v0',
        commandId: 'expected-command',
        result: { kind: 'succeeded', value: {} },
      },
      'expected-command'
    )).toThrow(/계약/);
  });

  test.each([
    null,
    {},
    { contractVersion: 'household-command-response.v1', commandId: 'cmd', result: { kind: 'succeeded' } },
    { contractVersion: 'household-command-response.v1', commandId: 'cmd', result: { kind: 'rejected', error: {} } },
  ])('불완전한 wire 응답 %#을 거부한다', (wire) => {
    expect(() => parseHouseholdCommandWireResponse(wire, 'cmd')).toThrow();
  });
});
