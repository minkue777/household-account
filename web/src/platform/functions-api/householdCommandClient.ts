import {
  HOUSEHOLD_COMMAND_CONTRACT_VERSION,
  HouseholdCommandEnvelope,
  HouseholdCommandName,
  HouseholdCommandPayloads,
  HouseholdCommandOutcome,
  HouseholdCommandResults,
  isTenantlessCommand,
} from './householdCommandContract';

export interface HouseholdCommandTransport {
  send<Name extends HouseholdCommandName>(
    envelope: HouseholdCommandEnvelope<Name>
  ): Promise<HouseholdCommandOutcome<HouseholdCommandResults[Name]>>;
}

export interface ExecuteHouseholdCommandOptions {
  householdId?: string;
  commandId?: string;
  idempotencyKey?: string;
}

export class HouseholdCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'HouseholdCommandError';
  }
}

export function createHouseholdCommandId(prefix = 'web-command'): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return `${prefix}-${id}`;

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assertTenant(command: HouseholdCommandName, householdId: string | undefined): void {
  if (!isTenantlessCommand(command) && !householdId?.trim()) {
    throw new HouseholdCommandError(
      'HOUSEHOLD_ID_REQUIRED',
      `${command} 명령에는 householdId가 필요합니다.`
    );
  }
}

export class HouseholdCommandClient {
  constructor(
    private readonly transport: HouseholdCommandTransport,
    private readonly resolveSessionHouseholdId?: () => string | undefined
  ) {}

  async execute<Name extends HouseholdCommandName>(
    command: Name,
    payload: HouseholdCommandPayloads[Name],
    options: ExecuteHouseholdCommandOptions = {}
  ): Promise<HouseholdCommandResults[Name]> {
    const sessionHouseholdId = this.resolveSessionHouseholdId?.();
    if (
      !isTenantlessCommand(command) &&
      sessionHouseholdId &&
      options.householdId &&
      options.householdId !== sessionHouseholdId
    ) {
      throw new HouseholdCommandError(
        'HOUSEHOLD_SCOPE_MISMATCH',
        '명령의 가구 범위가 현재 인증 세션과 일치하지 않습니다.'
      );
    }
    const householdId = isTenantlessCommand(command)
      ? undefined
      : sessionHouseholdId ?? options.householdId;
    assertTenant(command, householdId);

    const commandId = options.commandId ?? createHouseholdCommandId();
    const envelope: HouseholdCommandEnvelope<Name> = {
      contractVersion: HOUSEHOLD_COMMAND_CONTRACT_VERSION,
      commandId,
      idempotencyKey: options.idempotencyKey ?? commandId,
      ...(householdId ? { householdId } : {}),
      command,
      payload,
    };

    const result = await this.transport.send(envelope);
    if (result.kind === 'rejected') {
      throw new HouseholdCommandError(
        result.error.code,
        `명령이 거부되었습니다: ${result.error.code}`,
        result.error.retryable
      );
    }

    return result.value;
  }
}
