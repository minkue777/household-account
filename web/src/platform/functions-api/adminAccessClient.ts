import {
  ADMIN_ACCESS_CONTRACT_VERSION,
  type AdminAccessEnvelope,
  type AdminAccessOperation,
  type AdminAccessOutcome,
  type AdminAccessPayloads,
  type AdminAccessResults,
} from './adminAccessContract';

export interface AdminAccessTransport {
  send<Operation extends AdminAccessOperation>(
    envelope: AdminAccessEnvelope<Operation>
  ): Promise<AdminAccessOutcome<AdminAccessResults[Operation]>>;
}

export class AdminAccessError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(`관리자 요청이 거부되었습니다: ${code}`);
    this.name = 'AdminAccessError';
  }
}

function requestId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web-admin-${suffix}`;
}

export class AdminAccessClient {
  constructor(private readonly transport: AdminAccessTransport) {}

  async execute<Operation extends AdminAccessOperation>(
    operation: Operation,
    payload: AdminAccessPayloads[Operation]
  ): Promise<AdminAccessResults[Operation]> {
    const id = requestId();
    const outcome = await this.transport.send({
      contractVersion: ADMIN_ACCESS_CONTRACT_VERSION,
      requestId: id,
      idempotencyKey: id,
      operation,
      payload,
    });
    if (outcome.kind === 'rejected') {
      throw new AdminAccessError(outcome.error.code, outcome.error.retryable);
    }
    return outcome.value;
  }
}
