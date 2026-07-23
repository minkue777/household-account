import type { AssetOwnerProfileWireView } from './accessContractTypes';

export const HOUSEHOLD_COMMAND_CONTRACT_VERSION = 'household-command.v1' as const;

export interface LedgerTransactionCommandResult {
  transactionId: string;
  householdId: string;
  transactionType: 'expense' | 'income';
  merchant: string;
  memo: string;
  amountInWon: number;
  categoryId: string;
  accountingDate: string;
  localTime: string;
  cardDisplay: string;
  cardType: 'manual' | 'captured';
  creatorMemberId: string;
  lifecycleState: 'active' | 'deleted';
  aggregateVersion: number;
}

export const TENANTLESS_COMMANDS = [
  'access.resolve-signed-in-user.v1',
  'access.claim-legacy-membership.v1',
  'access.create-household-with-self.v1',
  'access.join-household-as-self.v1',
] as const;

export type TenantlessHouseholdCommand = (typeof TENANTLESS_COMMANDS)[number];

export interface HouseholdCommandPayloads {
  'access.resolve-signed-in-user.v1': Record<string, never>;
  'access.claim-legacy-membership.v1': {
    legacyHouseholdId: string;
    legacyMemberId: string;
    legacyMemberName?: string;
  };
  'access.create-household-with-self.v1': { householdName: string; memberName: string };
  'access.join-household-as-self.v1': { invitationCode: string; memberName: string };
  'access.create-invitation.v1': Record<string, never>;
  'access.rename-self.v1': { displayName: string; expectedVersion: number };
  'access.request-household-deletion.v1': Record<string, never>;
  'access.create-asset-owner-profile.v1': { displayName: string };
  'access.rename-asset-owner-profile.v1': {
    profileId: string;
    displayName: string;
    expectedVersion: number;
  };
  'access.archive-asset-owner-profile.v1': {
    profileId: string;
    expectedVersion: number;
  };

  'ledger.record-manual-transaction.v1':
  | {
    transactionType: 'expense';
    merchant: string;
    amountInWon: number;
    categoryId: string;
    accountingDate: string;
    memo?: string;
  }
  | {
    transactionType: 'income';
    itemName: string;
    amountInWon: number;
    accountingDate: string;
    memo?: string;
  };
  'ledger.record-manual-monthly-split.v1': {
    transactionType: 'expense';
    merchant: string;
    amountInWon: number;
    categoryId: string;
    accountingDate: string;
    memo?: string;
    months: number;
  };
  'ledger.split-existing-transaction-monthly.v1': {
    transactionId: string;
    expectedVersion: number;
    months: number;
  };
  'ledger.update-transaction.v1': {
    transactionId: string;
    expectedVersion: number;
    patch: {
      merchant?: string;
      memo?: string;
      amountInWon?: number;
      categoryId?: string;
      accountingDate?: string;
    };
  };
  'ledger.delete-transaction.v1': { transactionId: string; expectedVersion: number };
  'ledger.change-transaction-category.v1': { transactionId: string; categoryId: string; expectedVersion: number };
  'ledger.split-transaction.v1': {
    transactionId: string;
    items: ReadonlyArray<{
      merchant: string;
      amountInWon: number;
      categoryId: string;
      memo?: string;
    }>;
    expectedVersion: number;
  };
  'ledger.merge-transactions.v1': { targetTransactionId: string; sourceTransactionId: string; expectedVersions: Record<string, number> };
  'ledger.unmerge-transaction.v1': { transactionId: string; expectedVersion: number };
  'ledger.cancel-monthly-split.v1': {
    splitGroupId: string;
    expectedVersions: Record<string, number>;
  };
  'ledger.reconfigure-monthly-split.v1': {
    splitGroupId: string;
    months: number;
    expectedVersions: Record<string, number>;
  };
  'ledger.request-notification.v1': { transactionId: string; expectedVersion: number };

  'category.create.v1': { category: Record<string, unknown> };
  'category.update.v1': { categoryId: string; changes: Record<string, unknown> };
  'category.archive.v1': { categoryId: string };
  'category.set-budget.v1': { categoryId: string; budget: number | null };
  'category.reorder.v1': { categories: ReadonlyArray<{ categoryId: string; order: number }> };
  'category.set-default.v1': { categoryId: string };
  'home.update-summary-preferences.v1': { leftCard: string; rightCard: string };
  'home.select-local-currency.v1': { localCurrencyTypeId: string };

  'portfolio.create-asset.v1': { asset: Record<string, unknown> };
  'portfolio.update-asset.v1': { assetId: string; changes: Record<string, unknown>; expectedVersion: number };
  'portfolio.reorder-assets.v1': { assets: ReadonlyArray<{ assetId: string; order: number }> };
  'portfolio.delete-asset.v1': { assetId: string; expectedVersion: number };
  'portfolio.add-position.v1': { assetId: string; positionKind: 'stock' | 'crypto'; position: Record<string, unknown> };
  'portfolio.update-position.v1': { assetId: string; positionId: string; positionKind: 'stock' | 'crypto'; changes: Record<string, unknown>; expectedVersion: number };
  'portfolio.delete-position.v1': { assetId: string; positionId: string; positionKind: 'stock' | 'crypto'; expectedVersion: number };
  'portfolio.refresh-market-values.v1': { assetClass: 'stock' | 'crypto' | 'physical-gold' | 'all' };

  'payment-configuration.create-merchant-rule.v1': { rule: Record<string, unknown> };
  'payment-configuration.update-merchant-rule.v1': { ruleId: string; changes: Record<string, unknown> };
  'payment-configuration.delete-merchant-rule.v1': { ruleId: string };
  'payment-configuration.register-card.v1': { card: Record<string, unknown> };
  'payment-configuration.update-card.v1': { cardId: string; changes: Record<string, unknown> };
  'payment-configuration.delete-card.v1': { cardId: string };
  'payment-configuration.reorder-cards.v1': { cardIds: string[] };
  'shortcut.issue-credential.v1': Record<string, never>;
  'shortcut.reissue-credential.v1': {
    currentCredentialId: string;
    expectedVersion: number;
  };
  'shortcut.revoke-credential.v1': {
    credentialId: string;
    expectedVersion: number;
  };

  'recurring.create-plan.v1': { plan: Record<string, unknown> };
  'recurring.update-plan.v1': { planId: string; changes: Record<string, unknown> };
  'recurring.delete-plan.v1': { planId: string };
  'notifications.register-endpoint.v1': {
    fid: string;
    platform: 'ios-pwa' | 'android';
    deviceInfo?: { model?: string; osVersion?: string; appVersion?: string };
  };
  'notifications.remove-endpoint.v1':
    | { fid: string; reason: 'logout' }
    | { fid: string; reason: 'sdk-unregistered'; expectedRegistrationVersion: number };
}

export interface HouseholdCommandResults {
  'access.resolve-signed-in-user.v1':
    | {
        kind: 'membership-found';
        membership: {
          householdId: string;
          memberId: string;
          displayName: string;
          aggregateVersion: number;
          status: 'active';
          capabilities: string[];
        };
        household?: {
          id: string;
          name: string;
          createdAt: string;
          defaultCategoryKey?: string;
          homeSummaryConfig?: {
            leftCard: string;
            rightCard: string;
          };
          members: Array<{
            id: string;
            name: string;
            aggregateVersion: number;
          }>;
        };
      }
    | { kind: 'first-visit-required'; choices: Array<'create' | 'join'> };
  'access.claim-legacy-membership.v1': { householdId: string; memberId: string };
  'access.create-household-with-self.v1': { householdId: string; memberId: string };
  'access.join-household-as-self.v1': { householdId: string; memberId: string };
  'access.create-invitation.v1': { invitationCode: string; expiresAt: string };
  'access.rename-self.v1': Record<string, never>;
  'access.request-household-deletion.v1': Record<string, never>;
  'access.create-asset-owner-profile.v1': { profileId: string; displayName: string };
  'access.rename-asset-owner-profile.v1': AssetOwnerProfileWireView;
  'access.archive-asset-owner-profile.v1': AssetOwnerProfileWireView;

  'ledger.record-manual-transaction.v1': LedgerTransactionCommandResult;
  'ledger.record-manual-monthly-split.v1': { transactionIds: string[]; splitGroupId: string };
  'ledger.split-existing-transaction-monthly.v1': { transactionIds: string[]; splitGroupId: string };
  'ledger.update-transaction.v1': LedgerTransactionCommandResult;
  'ledger.delete-transaction.v1': LedgerTransactionCommandResult;
  'ledger.change-transaction-category.v1': LedgerTransactionCommandResult;
  'ledger.split-transaction.v1': { transactionIds: string[] };
  'ledger.merge-transactions.v1': Record<string, never>;
  'ledger.unmerge-transaction.v1': { transactionIds: string[] };
  'ledger.cancel-monthly-split.v1': Record<string, never>;
  'ledger.reconfigure-monthly-split.v1': { splitGroupId: string };
  'ledger.request-notification.v1': LedgerTransactionCommandResult;

  'category.create.v1': { categoryId: string };
  'category.update.v1': Record<string, never>;
  'category.archive.v1': Record<string, never>;
  'category.set-budget.v1': Record<string, never>;
  'category.reorder.v1': Record<string, never>;
  'category.set-default.v1': Record<string, never>;
  'home.update-summary-preferences.v1': Record<string, never>;
  'home.select-local-currency.v1': Record<string, never>;

  'portfolio.create-asset.v1': { assetId: string };
  'portfolio.update-asset.v1': Record<string, never>;
  'portfolio.reorder-assets.v1': Record<string, never>;
  'portfolio.delete-asset.v1': Record<string, never>;
  'portfolio.add-position.v1': { positionId: string };
  'portfolio.update-position.v1': Record<string, never>;
  'portfolio.delete-position.v1': Record<string, never>;
  'portfolio.refresh-market-values.v1': { refreshedCount: number };

  'payment-configuration.create-merchant-rule.v1': { ruleId: string };
  'payment-configuration.update-merchant-rule.v1': Record<string, never>;
  'payment-configuration.delete-merchant-rule.v1': Record<string, never>;
  'payment-configuration.register-card.v1': { cardId: string };
  'payment-configuration.update-card.v1': Record<string, never>;
  'payment-configuration.delete-card.v1': Record<string, never>;
  'payment-configuration.reorder-cards.v1': Record<string, never>;
  'shortcut.issue-credential.v1': ShortcutCredentialIssueResult;
  'shortcut.reissue-credential.v1': ShortcutCredentialIssueResult;
  'shortcut.revoke-credential.v1':
    | { kind: 'revoked'; credentialId: string; credentialVersion: number }
    | { kind: 'alreadyRevoked'; credentialId: string }
    | { kind: 'notFound' };

  'recurring.create-plan.v1': { planId: string };
  'recurring.update-plan.v1': Record<string, never>;
  'recurring.delete-plan.v1': Record<string, never>;
  'notifications.register-endpoint.v1': {
    kind: 'registered';
    endpointId: string;
    registrationVersion: number;
    result: 'created' | 'refreshed' | 'stale-binding-recovered';
  };
  'notifications.remove-endpoint.v1':
    | { kind: 'removed'; endpointId: string }
    | { kind: 'already-absent' }
    | { kind: 'stale-ignored'; endpointId: string }
    | { kind: 'inactivated'; endpointId: string };
}

export type ShortcutCredentialIssueResult =
  | {
      kind: 'issued';
      credentialId: string;
      credentialVersion: number;
      rawCredential: string;
      installUrl: string;
      issuedAt: string;
    }
  | {
      kind: 'alreadyIssued';
      credentialId: string;
      credentialVersion: number;
    };

export type HouseholdCommandName = keyof HouseholdCommandPayloads & keyof HouseholdCommandResults;

export interface HouseholdCommandEnvelope<Name extends HouseholdCommandName = HouseholdCommandName> {
  contractVersion: typeof HOUSEHOLD_COMMAND_CONTRACT_VERSION;
  commandId: string;
  idempotencyKey: string;
  householdId?: string;
  command: Name;
  payload: HouseholdCommandPayloads[Name];
}

export const HOUSEHOLD_COMMAND_RESPONSE_CONTRACT_VERSION =
  'household-command-response.v1' as const;

export type HouseholdCommandOutcome<Result> =
  | { kind: 'succeeded'; value: Result }
  | { kind: 'already-processed'; value: Result }
  | { kind: 'rejected'; error: { code: string; retryable: boolean } };

export interface HouseholdCommandWireResponse<Result> {
  contractVersion: typeof HOUSEHOLD_COMMAND_RESPONSE_CONTRACT_VERSION;
  commandId: string;
  result: HouseholdCommandOutcome<Result>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseHouseholdCommandWireResponse<Result>(
  value: unknown,
  expectedCommandId: string
): HouseholdCommandOutcome<Result> {
  if (!isRecord(value)) throw new Error('명령 응답이 객체가 아닙니다.');
  if (value.contractVersion !== HOUSEHOLD_COMMAND_RESPONSE_CONTRACT_VERSION) {
    throw new Error('지원하지 않는 명령 응답 계약입니다.');
  }
  if (value.commandId !== expectedCommandId) {
    throw new Error('명령 응답의 commandId가 요청과 일치하지 않습니다.');
  }
  if (!isRecord(value.result)) throw new Error('명령 응답에 result가 없습니다.');

  if (value.result.kind === 'succeeded' || value.result.kind === 'already-processed') {
    if (!('value' in value.result)) throw new Error('성공 응답에 value가 없습니다.');
    return value.result as HouseholdCommandOutcome<Result>;
  }

  if (value.result.kind === 'rejected' && isRecord(value.result.error)) {
    if (
      typeof value.result.error.code !== 'string' ||
      typeof value.result.error.retryable !== 'boolean'
    ) {
      throw new Error('거부 응답의 error 형식이 올바르지 않습니다.');
    }
    return value.result as HouseholdCommandOutcome<Result>;
  }

  throw new Error('알 수 없는 명령 결과입니다.');
}

export function isTenantlessCommand(command: HouseholdCommandName): command is TenantlessHouseholdCommand {
  return (TENANTLESS_COMMANDS as readonly string[]).includes(command);
}
