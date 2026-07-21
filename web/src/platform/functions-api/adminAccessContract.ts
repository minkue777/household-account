import type {
  AdminDeletedAssetWireView,
  AdminHouseholdWireView,
  AdminMemberWireView,
} from './accessContractTypes';

export const ADMIN_ACCESS_CONTRACT_VERSION = 'admin-access.v1' as const;
export const ADMIN_ACCESS_RESPONSE_VERSION = 'admin-access-response.v1' as const;

export interface AdminAccessPayloads {
  'list-households': { cursor?: string; limit?: number };
  'create-household': { name: string };
  'get-legacy-share-key': { householdId: string };
  'delete-household': {
    householdId: string;
    confirmed: true;
    expectedVersion: number;
  };
  'restore-household': {
    householdId: string;
    reason: string;
    expectedVersion: number;
  };
  'list-household-members': { householdId: string };
  'remove-household-member': {
    householdId: string;
    memberId: string;
    reason: string;
    expectedVersion: number;
  };
  'restore-household-member': {
    householdId: string;
    memberId: string;
    expectedVersion: number;
  };
  'list-deleted-assets': { householdId: string };
  'restore-deleted-asset': {
    householdId: string;
    assetId: string;
    auditReason: string;
    expectedVersion: number;
  };
}

export interface AdminAccessResults {
  'list-households': {
    items: AdminHouseholdWireView[];
    nextCursor?: string;
  };
  'create-household': AdminHouseholdWireView;
  'get-legacy-share-key': { legacyShareKey: string };
  'delete-household': AdminHouseholdWireView;
  'restore-household': {
    householdId: string;
    lifecycleState: 'active';
    aggregateVersion: number;
  };
  'list-household-members': { members: AdminMemberWireView[] };
  'remove-household-member': {
    memberId: string;
    membershipStatus?: 'removed';
    membershipVersion: number;
  };
  'restore-household-member': {
    memberId: string;
    membershipStatus?: 'active';
    membershipVersion: number;
  };
  'list-deleted-assets': { assets: AdminDeletedAssetWireView[] };
  'restore-deleted-asset': {
    kind: 'success';
    asset: {
      assetId: string;
      householdId: string;
      lifecycleState: 'active';
      aggregateVersion: number;
    };
    resumeFromDate?: string;
  };
}

export type AdminAccessOperation = keyof AdminAccessPayloads & keyof AdminAccessResults;

export interface AdminAccessEnvelope<Operation extends AdminAccessOperation = AdminAccessOperation> {
  contractVersion: typeof ADMIN_ACCESS_CONTRACT_VERSION;
  requestId: string;
  idempotencyKey: string;
  operation: Operation;
  payload: AdminAccessPayloads[Operation];
}

export type AdminAccessOutcome<Result> =
  | { kind: 'succeeded'; value: Result }
  | { kind: 'rejected'; error: { code: string; retryable: boolean } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAdminAccessWireResponse<Result>(
  value: unknown,
  expectedRequestId: string
): AdminAccessOutcome<Result> {
  if (!isRecord(value) || value.contractVersion !== ADMIN_ACCESS_RESPONSE_VERSION) {
    throw new Error('지원하지 않는 관리자 응답 계약입니다.');
  }
  if (value.requestId !== expectedRequestId || !isRecord(value.result)) {
    throw new Error('관리자 응답이 요청과 일치하지 않습니다.');
  }
  if (value.result.kind === 'succeeded' && 'value' in value.result) {
    return value.result as AdminAccessOutcome<Result>;
  }
  if (
    value.result.kind === 'rejected' &&
    isRecord(value.result.error) &&
    typeof value.result.error.code === 'string' &&
    typeof value.result.error.retryable === 'boolean'
  ) {
    return value.result as AdminAccessOutcome<Result>;
  }
  throw new Error('알 수 없는 관리자 응답입니다.');
}
