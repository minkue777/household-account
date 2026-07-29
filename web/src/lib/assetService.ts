import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  QueryDocumentSnapshot,
  DocumentData,
  orderBy,
  db,
  timestampToDate,
} from '@/platform/read-model/firestoreReadModel';
import {
  Asset,
  AssetHistoryEntry,
  AssetInput,
  AssetType,
  CryptoHolding,
  CryptoHoldingInput,
  StockHolding,
  StockHoldingInput,
  isGoldEtfSubType,
} from '@/types/asset';
import { requireClientSessionScope } from '@/composition/clientSessionScope';
import { portfolioCommands } from '@/features/portfolio/application/portfolioCommands';
import {
  cryptoHoldingOptimisticProjection,
  portfolioOptimisticProjection,
  stockHoldingOptimisticProjection,
} from '@/features/portfolio/application/portfolioOptimisticProjection';
import { createHouseholdCommandId } from '@/platform/functions-api/householdCommandClient';
import { registerClientSessionReset } from '@/composition/clientSessionResetRegistry';
import { formatLocalDate } from './utils/date';
import { sumSignedBalancesByAssetType } from './assets/assetMath';
import {
  calculateHoldingCostBasis,
  calculateHoldingValue,
} from './assets/holdingValuation';

const ASSETS_COLLECTION = 'assets';
const HISTORY_COLLECTION = 'asset_history';
const HOLDINGS_COLLECTION = 'stock_holdings';
const CRYPTO_HOLDINGS_COLLECTION = 'crypto_holdings';

const assetUpdateTails = new Map<string, Promise<void>>();
const stockMutationTails = new Map<string, Promise<void>>();
const cryptoMutationTails = new Map<string, Promise<void>>();
let assetUpdateQueueGeneration = 0;
const ASSET_AUTHORITATIVE_WAIT_TIMEOUT_MS = 20_000;

interface VersionedPortfolioEntity {
  readonly id: string;
  readonly aggregateVersion: number;
}

interface AuthoritativeWaiter<Entity extends VersionedPortfolioEntity> {
  readonly entityId: string;
  readonly minimumVersionExclusive?: number;
  readonly resolve: (entity: Entity) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

type AuthoritativeSubscriptionStatus = 'pending' | 'ready' | 'failed';

interface AuthoritativeState<Entity extends VersionedPortfolioEntity> {
  readonly generation: number;
  readonly serverEntities: Map<string, Entity>;
  readonly commandFloors: Map<string, Entity>;
  readonly startupEntities: Map<string, Entity>;
  readonly waiters: Set<AuthoritativeWaiter<Entity>>;
  readonly subscriptions: Map<number, AuthoritativeSubscriptionStatus>;
  failureCode?: string;
  ready: boolean;
}

const assetAuthoritativeStates = new Map<string, AuthoritativeState<Asset>>();
const stockAuthoritativeStates =
  new Map<string, AuthoritativeState<StockHolding>>();
const cryptoAuthoritativeStates =
  new Map<string, AuthoritativeState<CryptoHolding>>();
let nextAuthoritativeSubscriptionId = 1;

function rejectAuthoritativeWaiters<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>,
  code: string
): void {
  const error = new Error(code);
  state.waiters.forEach((waiter) => {
    clearTimeout(waiter.timeoutId);
    waiter.reject(error);
  });
  state.waiters.clear();
}

registerClientSessionReset(() => {
  function resetStates<Entity extends VersionedPortfolioEntity>(
    states: Map<string, AuthoritativeState<Entity>>
  ): void {
    states.forEach((state) => {
      rejectAuthoritativeWaiters(state, 'CLIENT_SESSION_RESET');
    });
    states.clear();
  }
  resetStates(assetAuthoritativeStates);
  resetStates(stockAuthoritativeStates);
  resetStates(cryptoAuthoritativeStates);
  assetUpdateQueueGeneration += 1;
  assetUpdateTails.clear();
  stockMutationTails.clear();
  cryptoMutationTails.clear();
});

/**
 * 현재 가구 키 가져오기
 */
function getHouseholdId(): string {
  return requireClientSessionScope().householdId;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (
    typeof left === 'object' && left !== null
    && typeof right === 'object' && right !== null
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function hasPatchChanges<Entity extends object>(current: Entity, patch: Partial<Entity>): boolean {
  const currentRecord = current as Record<string, unknown>;
  return Object.entries(patch).some(([key, value]) => !valuesEqual(currentRecord[key], value));
}

function changedPatch<Entity extends object>(
  current: Entity,
  patch: Partial<Entity>
): Partial<Entity> {
  const currentRecord = current as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => !valuesEqual(currentRecord[key], value)
    )
  ) as Partial<Entity>;
}

/**
 * A form can stay open while the authoritative read model advances in the
 * background. Only values that differ both from the frozen edit base and from
 * the current projection are actual user intent. This keeps system-updated
 * fields out of a stale form submission without hiding a real user edit.
 */
function intendedPatch<Entity extends object>(
  editBase: Entity,
  current: Entity,
  submitted: Partial<Entity>
): Partial<Entity> {
  return changedPatch(current, changedPatch(editBase, submitted));
}

function assetConflictPatch(
  editBase: Asset,
  submittedPatch: Partial<Asset>
): Partial<Asset> {
  const isPhysicalGold =
    (submittedPatch.type ?? editBase.type) === 'gold'
    && !isGoldEtfSubType(submittedPatch.subType ?? editBase.subType);
  const quantityWasEdited =
    Object.prototype.hasOwnProperty.call(submittedPatch, 'quantity');
  if (!isPhysicalGold || !quantityWasEdited) {
    return submittedPatch;
  }

  // Physical-gold balance is derived from quantity and the latest quote. A
  // quote refresh may legitimately change currentBalance while the modal is
  // open; quantity remains the user's conflict-bearing input.
  const { currentBalance: _derivedBalance, ...conflictPatch } = submittedPatch;
  return conflictPatch;
}

function intendedAssetPatch(
  editBase: Asset,
  current: Asset,
  submitted: Partial<Asset>
): Partial<Asset> {
  const patch = intendedPatch(editBase, current, submitted);
  const isPhysicalGold =
    (patch.type ?? submitted.type ?? editBase.type) === 'gold'
    && !isGoldEtfSubType(patch.subType ?? submitted.subType ?? editBase.subType);
  const quantityWasEdited = Object.prototype.hasOwnProperty.call(
    patch,
    'quantity'
  );
  if (!isPhysicalGold || quantityWasEdited) {
    return patch;
  }

  // currentBalance is not an independently editable field for physical gold.
  // If quantity did not change, a balance difference came from a quote refresh.
  const { currentBalance: _derivedBalance, ...userPatch } = patch;
  return userPatch;
}

function createAuthoritativeState<
  Entity extends VersionedPortfolioEntity,
>(): AuthoritativeState<Entity> {
  return {
    generation: assetUpdateQueueGeneration,
    serverEntities: new Map(),
    commandFloors: new Map(),
    startupEntities: new Map(),
    waiters: new Set(),
    subscriptions: new Map(),
    ready: false,
  };
}

function getOrCreateAuthoritativeState<
  Entity extends VersionedPortfolioEntity,
>(
  states: Map<string, AuthoritativeState<Entity>>,
  householdId: string
): AuthoritativeState<Entity> {
  const existing = states.get(householdId);
  if (existing?.generation === assetUpdateQueueGeneration) return existing;

  const created = createAuthoritativeState<Entity>();
  states.set(householdId, created);
  return created;
}

function authoritativeEntity<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>,
  entityId: string
): Entity | undefined {
  const serverEntity = state.serverEntities.get(entityId);
  const commandFloor = state.commandFloors.get(entityId);
  if (!serverEntity) return commandFloor;
  if (!commandFloor) return serverEntity;
  return commandFloor.aggregateVersion > serverEntity.aggregateVersion
    ? commandFloor
    : serverEntity;
}

function resolveAuthoritativeWaiters<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>
): void {
  state.waiters.forEach((waiter) => {
    const entity = authoritativeEntity(state, waiter.entityId);
    if (
      entity
      && (
        waiter.minimumVersionExclusive === undefined
        || entity.aggregateVersion > waiter.minimumVersionExclusive
      )
    ) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(entity);
      state.waiters.delete(waiter);
    } else if (
      entity === undefined
      && waiter.minimumVersionExclusive === undefined
    ) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error('ASSET_VERSION_MISMATCH'));
      state.waiters.delete(waiter);
    }
  });
}

function publishAuthoritativeEntities<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>,
  subscriptionId: number,
  entities: readonly Entity[]
): void {
  state.serverEntities.clear();
  entities.forEach((entity) => state.serverEntities.set(entity.id, entity));
  state.commandFloors.forEach((floor, entityId) => {
    const serverEntity = state.serverEntities.get(entityId);
    if (
      serverEntity !== undefined
      && serverEntity.aggregateVersion >= floor.aggregateVersion
    ) {
      state.commandFloors.delete(entityId);
    }
  });
  state.subscriptions.set(subscriptionId, 'ready');
  state.failureCode = undefined;
  state.ready = true;
  resolveAuthoritativeWaiters(state);
}

function waitForAuthoritativeEntity<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>,
  entityId: string,
  queueGeneration: number,
  minimumVersionExclusive?: number
): Promise<Entity> {
  if (
    queueGeneration !== assetUpdateQueueGeneration
    || state.generation !== queueGeneration
  ) {
    return Promise.reject(new Error('CLIENT_SESSION_RESET'));
  }
  const commandFloor = state.commandFloors.get(entityId);
  if (commandFloor !== undefined || state.ready) {
    const entity = authoritativeEntity(state, entityId);
    if (
      entity
      && (
        minimumVersionExclusive === undefined
        || entity.aggregateVersion > minimumVersionExclusive
      )
    ) {
      return Promise.resolve(entity);
    }
    if (entity === undefined && minimumVersionExclusive === undefined) {
      return Promise.reject(new Error('ASSET_VERSION_MISMATCH'));
    }
  }
  if (state.failureCode !== undefined) {
    return Promise.reject(new Error(state.failureCode));
  }

  return new Promise<Entity>((resolve, reject) => {
    const waiter: AuthoritativeWaiter<Entity> = {
      entityId,
      ...(minimumVersionExclusive === undefined
        ? {}
        : { minimumVersionExclusive }),
      resolve,
      reject,
      timeoutId: setTimeout(() => {
        state.waiters.delete(waiter);
        reject(new Error('ASSET_AUTHORITATIVE_READ_TIMEOUT'));
      }, ASSET_AUTHORITATIVE_WAIT_TIMEOUT_MS),
    };
    state.waiters.add(waiter);
  });
}

function changedFieldsStillMatch<Entity extends VersionedPortfolioEntity>(
  original: Entity,
  fresh: Entity,
  patch: Partial<Entity>
): boolean {
  const originalRecord = original as unknown as Record<string, unknown>;
  const freshRecord = fresh as unknown as Record<string, unknown>;
  return Object.keys(patch).every((key) =>
    valuesEqual(originalRecord[key], freshRecord[key])
  );
}

function recordCommandFloor<Entity extends VersionedPortfolioEntity>(
  states: Map<string, AuthoritativeState<Entity>>,
  householdId: string,
  entity: Entity
): void {
  const state = states.get(householdId);
  if (
    state === undefined
    || state.generation !== assetUpdateQueueGeneration
  ) return;

  const existing = state.commandFloors.get(entity.id);
  const currentAuthority = authoritativeEntity(state, entity.id);
  if (
    currentAuthority !== undefined
    && currentAuthority.aggregateVersion > entity.aggregateVersion
  ) {
    return;
  }
  if (
    existing === undefined
    || existing.aggregateVersion <= entity.aggregateVersion
  ) {
    state.commandFloors.set(entity.id, entity);
  }
}

function startupEntityKey(entityId: string, aggregateVersion: number): string {
  return `${entityId}:${aggregateVersion}`;
}

function captureStartupEntities<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>,
  entities: readonly Entity[]
): void {
  if (state.ready) return;
  entities.forEach((entity) => {
    state.startupEntities.set(
      startupEntityKey(entity.id, entity.aggregateVersion),
      entity
    );
  });
}

function capturedStartupEntity<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity> | undefined,
  entityId: string,
  aggregateVersion: number
): Entity | undefined {
  return state?.startupEntities.get(
    startupEntityKey(entityId, aggregateVersion)
  );
}

function hasNewerAuthoritativeEntity<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity> | undefined,
  entityId: string,
  aggregateVersion: number
): boolean {
  const entity = state === undefined
    ? undefined
    : authoritativeEntity(state, entityId);
  return entity !== undefined && entity.aggregateVersion > aggregateVersion;
}

function registerAuthoritativeSubscription<
  Entity extends VersionedPortfolioEntity,
>(
  state: AuthoritativeState<Entity>
): number {
  if (state.subscriptions.size === 0) {
    state.ready = false;
    state.failureCode = undefined;
    state.startupEntities.clear();
  }
  const subscriptionId = nextAuthoritativeSubscriptionId++;
  state.subscriptions.set(subscriptionId, 'pending');
  return subscriptionId;
}

function failAuthoritativeSubscription<Entity extends VersionedPortfolioEntity>(
  state: AuthoritativeState<Entity>,
  subscriptionId: number,
  code: string
): void {
  if (!state.subscriptions.has(subscriptionId)) return;
  state.subscriptions.set(subscriptionId, 'failed');

  const hasViableSubscription = Array.from(state.subscriptions.values())
    .some((status) => status !== 'failed');
  if (!hasViableSubscription) {
    state.failureCode = code;
    rejectAuthoritativeWaiters(state, code);
  }
}

function unregisterAuthoritativeSubscription<
  Entity extends VersionedPortfolioEntity,
>(
  state: AuthoritativeState<Entity>,
  subscriptionId: number
): void {
  state.subscriptions.delete(subscriptionId);
  if (state.subscriptions.size === 0) {
    // React effect 재연결 사이의 짧은 listener 공백에서 진행 중인 저장을
    // 취소하지 않습니다. 새 구독이 붙지 않으면 개별 waiter deadline이 종료합니다.
    state.ready = false;
    state.failureCode = undefined;
  }
}

function sameEntityContent<Entity extends VersionedPortfolioEntity>(
  left: Entity,
  right: Entity
): boolean {
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  const keys = new Set(Object.keys(leftRecord));
  keys.delete('aggregateVersion');
  keys.delete('updatedAt');
  return Array.from(keys).every((key) =>
    valuesEqual(leftRecord[key], rightRecord[key])
  );
}

function commandErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

function isAssetVersionMismatch(error: unknown): boolean {
  return commandErrorCode(error) === 'ASSET_VERSION_MISMATCH';
}

function isPositionVersionMismatch(error: unknown): boolean {
  return commandErrorCode(error) === 'POSITION_VERSION_MISMATCH';
}

/**
 * Firestore 문서를 Asset 객체로 변환
 */
function mapDocToAsset(docSnap: QueryDocumentSnapshot<DocumentData>): Asset {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    aggregateVersion:
      Number.isSafeInteger(data.aggregateVersion) && data.aggregateVersion > 0
        ? data.aggregateVersion
        : 1,
    householdId: data.householdId,
    name: data.name,
    type: data.type,
    subType: data.subType,
    owner: data.owner,
    ownerRef:
      data.ownerRef?.kind === 'household'
        ? { kind: 'household' }
        : data.ownerRef?.kind === 'profile' && typeof data.ownerRef.profileId === 'string'
          ? { kind: 'profile', profileId: data.ownerRef.profileId }
          : undefined,
    currentBalance: data.currentBalance || 0,
    recurringContributionAmount: data.recurringContributionAmount || 0,
    recurringContributionDay: data.recurringContributionDay || 0,
    lastAutoContributionMonth: data.lastAutoContributionMonth || '',
    loanInterestRate: data.loanInterestRate || 0,
    loanRepaymentMethod: data.loanRepaymentMethod || '',
    loanMonthlyPaymentAmount: data.loanMonthlyPaymentAmount || 0,
    loanPaymentDay: data.loanPaymentDay || 0,
    lastAutoRepaymentMonth: data.lastAutoRepaymentMonth || '',
    costBasis: data.costBasis,
    initialInvestment: data.initialInvestment,
    currency: data.currency || 'KRW',
    memo: data.memo,
    icon: data.icon,
    color: data.color,
    isActive: data.isActive !== false,
    order: data.order || 0,
    stockCode: data.stockCode,
    quantity: data.quantity,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
    updatedAt: timestampToDate(data.updatedAt) ?? new Date(0),
  };
}

function extractPhysicalGoldQuantity(asset: Pick<Asset, 'quantity' | 'memo'>): number {
  if (typeof asset.quantity === 'number' && Number.isFinite(asset.quantity) && asset.quantity > 0) {
    return asset.quantity;
  }

  const match = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
  if (!match) {
    return 0;
  }

  const parsed = parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Firestore 문서를 AssetHistoryEntry 객체로 변환
 */
function mapDocToHistory(docSnap: QueryDocumentSnapshot<DocumentData>): AssetHistoryEntry {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    householdId: data.householdId,
    assetId: data.assetId,
    balance: data.balance,
    date: data.date,
    changeAmount: data.changeAmount,
    memo: data.memo,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
  };
}

/**
 * 자산 추가
 */
export async function addAsset(input: AssetInput): Promise<string> {
  const householdId = getHouseholdId();
  const commandId = createHouseholdCommandId('portfolio-create');
  const assetId = `asset-${householdId}-${commandId}`;
  const now = new Date();
  const optimisticAsset: Asset = {
    ...input,
    id: assetId,
    aggregateVersion: 1,
    householdId,
    createdAt: now,
    updatedAt: now,
  };
  const mutationId = portfolioOptimisticProjection.beginCreate(optimisticAsset);
  try {
    const confirmedAssetId = await portfolioCommands.createAsset(
      householdId,
      input,
      commandId
    );
    if (confirmedAssetId !== assetId) throw new Error('ASSET_ID_CONTRACT_MISMATCH');
    portfolioOptimisticProjection.commitCreate(mutationId, optimisticAsset);
    return confirmedAssetId;
  } catch (error) {
    portfolioOptimisticProjection.rollback(mutationId);
    throw error;
  }
}

/**
 * 자산 수정
 */
export async function updateAsset(
  id: string,
  data: Partial<Asset>,
  expectedVersion: number,
  editBase?: Asset
): Promise<void> {
  const current = portfolioOptimisticProjection.current(id);
  if (!current) throw new Error('ASSET_READ_MODEL_REQUIRED');
  const householdId = getHouseholdId();
  const authoritativeState = assetAuthoritativeStates.get(householdId);
  const capturedStartupBase = capturedStartupEntity(
    authoritativeState,
    id,
    expectedVersion
  );
  const suppliedEditBase =
    editBase?.id === id
    && editBase.aggregateVersion === expectedVersion
      ? editBase
      : undefined;
  const mutationBase = suppliedEditBase ?? capturedStartupBase ?? current;
  const effectivePatch = intendedAssetPatch(mutationBase, current, data);
  const conflictPatch = assetConflictPatch(mutationBase, effectivePatch);
  if (!hasPatchChanges(current, effectivePatch)) return;
  const previousUpdate = assetUpdateTails.get(id);
  const queueGeneration = assetUpdateQueueGeneration;
  const mutationId = previousUpdate === undefined
    ? portfolioOptimisticProjection.beginUpdate(id, effectivePatch)
    : portfolioOptimisticProjection.beginQueuedUpdate(id, effectivePatch);
  const pendingUpdate = (async () => {
    try {
      if (previousUpdate !== undefined) {
        await previousUpdate;
      }
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }

      let commandBase = current;
      let commandExpectedVersion =
        previousUpdate === undefined
          ? expectedVersion
          : current.aggregateVersion;
      const shouldUseAuthoritativeBase =
        authoritativeState !== undefined
        && (
          previousUpdate !== undefined
          || capturedStartupBase !== undefined
          || !authoritativeState.ready
          || hasNewerAuthoritativeEntity(
            authoritativeState,
            id,
            expectedVersion
          )
        );
      if (shouldUseAuthoritativeBase && authoritativeState !== undefined) {
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration
        );
        if (queueGeneration !== assetUpdateQueueGeneration) {
          throw new Error('CLIENT_SESSION_RESET');
        }

        if (!changedFieldsStillMatch(mutationBase, fresh, conflictPatch)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandBase = fresh;
        commandExpectedVersion = fresh.aggregateVersion;
      }

      try {
        await portfolioCommands.updateAsset(
          householdId,
          id,
          effectivePatch,
          commandExpectedVersion
        );
      } catch (error) {
        if (
          !isAssetVersionMismatch(error)
          || authoritativeState === undefined
        ) {
          throw error;
        }
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration,
          commandExpectedVersion
        );
        if (!changedFieldsStillMatch(mutationBase, fresh, conflictPatch)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandBase = fresh;
        commandExpectedVersion = fresh.aggregateVersion;
        await portfolioCommands.updateAsset(
          householdId,
          id,
          effectivePatch,
          commandExpectedVersion
        );
      }
      const canonical = {
        ...commandBase,
        ...effectivePatch,
        aggregateVersion: commandExpectedVersion + 1,
        updatedAt: new Date(),
      };
      if (queueGeneration === assetUpdateQueueGeneration) {
        recordCommandFloor(assetAuthoritativeStates, householdId, canonical);
        portfolioOptimisticProjection.commitUpdate(mutationId, canonical);
      }
    } catch (error) {
      portfolioOptimisticProjection.rollback(mutationId);
      throw error;
    }
  })();

  assetUpdateTails.set(id, pendingUpdate);
  const clearTail = () => {
    if (assetUpdateTails.get(id) === pendingUpdate) {
      assetUpdateTails.delete(id);
    }
  };
  void pendingUpdate.then(clearTail, clearTail);
  await pendingUpdate;
}

/**
 * 자산 순서 일괄 업데이트
 */
export async function updateAssetOrders(assetOrders: { id: string; order: number }[]): Promise<void> {
  const normalized = assetOrders.map(({ id }, order) => ({ id, order }));
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const previousById = new Map(
    normalized.map(({ id }) => [id, assetUpdateTails.get(id)])
  );
  const planned = normalized.map((update) => {
    const current = portfolioOptimisticProjection.current(update.id);
    if (!current) throw new Error('ASSET_READ_MODEL_REQUIRED');
    return { current, update };
  });
  const changed = planned.filter(({ current, update }) => current.order !== update.order);
  if (changed.length === 0) return;
  const mutations: Array<{
    current: Asset;
    update: { id: string; order: number };
    mutationId: string;
  }> = [];
  try {
    changed.forEach(({ current, update }) => {
      mutations.push({
        current,
        update,
        mutationId: previousById.get(update.id) === undefined
          ? portfolioOptimisticProjection.beginUpdate(
              update.id,
              { order: update.order }
            )
          : portfolioOptimisticProjection.beginQueuedUpdate(
              update.id,
              { order: update.order }
            ),
      });
    });
  } catch (error) {
    mutations.forEach(({ mutationId }) =>
      portfolioOptimisticProjection.rollback(mutationId)
    );
    throw error;
  }

  const priorMutations = Array.from(
    new Set(
      Array.from(previousById.values()).filter(
        (pending): pending is Promise<void> => pending !== undefined
      )
    )
  );
  const pendingReorder = (async () => {
    try {
      await Promise.all(priorMutations);
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }
      // Freeze the command base before sending. A listener may observe a
      // separate, newer write while this command is in flight; deriving the
      // reorder version from that response-time snapshot would invent a
      // version that this command never created.
      const commandBases = new Map(
        mutations.map(({ current, update }) => {
          const authoritative = assetAuthoritativeStates.get(householdId);
          return [
            update.id,
            authoritative === undefined
              ? current
              : authoritativeEntity(authoritative, update.id) ?? current,
          ] as const;
        })
      );
      await portfolioCommands.reorderAssets(householdId, normalized);
      mutations.forEach(({ current, update, mutationId }) => {
        const commandBase = commandBases.get(update.id) ?? current;
        const canonical = {
          ...commandBase,
          order: update.order,
          aggregateVersion: commandBase.aggregateVersion + 1,
          updatedAt: new Date(),
        };
        recordCommandFloor(assetAuthoritativeStates, householdId, canonical);
        portfolioOptimisticProjection.commitUpdate(mutationId, canonical);
      });
    } catch (error) {
      mutations.forEach(({ mutationId }) =>
        portfolioOptimisticProjection.rollback(mutationId)
      );
      throw error;
    }
  })();

  normalized.forEach(({ id }) => assetUpdateTails.set(id, pendingReorder));
  const clearTails = () => {
    normalized.forEach(({ id }) => {
      if (assetUpdateTails.get(id) === pendingReorder) {
        assetUpdateTails.delete(id);
      }
    });
  };
  void pendingReorder.then(clearTails, clearTails);
  await pendingReorder;
}

/**
 * 자산 논리 삭제 (이력과 보유 내역은 운영 복구를 위해 보존)
 */
export async function deleteAsset(
  id: string,
  expectedVersion: number,
  editBase?: Asset
): Promise<void> {
  const current = portfolioOptimisticProjection.current(id);
  if (!current) throw new Error('ASSET_READ_MODEL_REQUIRED');
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const previousMutation = assetUpdateTails.get(id);
  const authoritativeState = assetAuthoritativeStates.get(householdId);
  const capturedStartupBase = capturedStartupEntity(
    authoritativeState,
    id,
    expectedVersion
  );
  const mutationBase =
    editBase?.id === id
    && editBase.aggregateVersion === expectedVersion
      ? editBase
      : capturedStartupBase ?? current;
  const mutationId = previousMutation === undefined
    ? portfolioOptimisticProjection.beginDelete(id)
    : portfolioOptimisticProjection.beginQueuedDelete(id);
  const pendingDelete = (async () => {
    try {
      if (previousMutation !== undefined) {
        await previousMutation;
      }
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }

      let commandExpectedVersion =
        previousMutation === undefined
          ? expectedVersion
          : current.aggregateVersion;
      if (
        authoritativeState !== undefined
        && (
          previousMutation !== undefined
          || capturedStartupBase !== undefined
          || !authoritativeState.ready
          || hasNewerAuthoritativeEntity(
            authoritativeState,
            id,
            expectedVersion
          )
        )
      ) {
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration
        );
        if (!sameEntityContent(mutationBase, fresh)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandExpectedVersion = fresh.aggregateVersion;
      }
      try {
        await portfolioCommands.deleteAsset(
          householdId,
          id,
          commandExpectedVersion
        );
      } catch (error) {
        if (
          !isAssetVersionMismatch(error)
          || authoritativeState === undefined
        ) {
          throw error;
        }
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration,
          commandExpectedVersion
        );
        if (!sameEntityContent(mutationBase, fresh)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandExpectedVersion = fresh.aggregateVersion;
        await portfolioCommands.deleteAsset(
          householdId,
          id,
          commandExpectedVersion
        );
      }
      if (queueGeneration === assetUpdateQueueGeneration) {
        portfolioOptimisticProjection.commitDelete(mutationId);
      }
    } catch (error) {
      portfolioOptimisticProjection.rollback(mutationId);
      throw error;
    }
  })();

  assetUpdateTails.set(id, pendingDelete);
  const clearTail = () => {
    if (assetUpdateTails.get(id) === pendingDelete) {
      assetUpdateTails.delete(id);
    }
  };
  void pendingDelete.then(clearTail, clearTail);
  await pendingDelete;
}

/**
 * 자산 목록 실시간 구독
 */
export function subscribeToAssets(
  callback: (assets: Asset[]) => void,
  initialAssets?: readonly Asset[],
  onSourceSnapshot?: (
    assets: readonly Asset[],
    metadata: { fromCache: boolean }
  ) => void
): () => void {
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const authoritativeState = getOrCreateAuthoritativeState(
    assetAuthoritativeStates,
    householdId
  );
  const subscriptionId =
    registerAuthoritativeSubscription(authoritativeState);
  captureStartupEntities(authoritativeState, initialAssets ?? []);
  const projection = portfolioOptimisticProjection.subscribe(callback, householdId);
  if (initialAssets !== undefined) {
    projection.publish(initialAssets);
  }

  const q = query(
    collection(db, ASSETS_COLLECTION),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (
        queueGeneration !== assetUpdateQueueGeneration
        || assetAuthoritativeStates.get(householdId) !== authoritativeState
      ) return;
      const assets = snapshot.docs.map(mapDocToAsset);
      // order 순으로 정렬, 같으면 이름순
      assets.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
      if (snapshot.metadata.fromCache) {
        captureStartupEntities(authoritativeState, assets);
      } else {
        publishAuthoritativeEntities(
          authoritativeState,
          subscriptionId,
          assets
        );
      }
      onSourceSnapshot?.(assets, {
        fromCache: snapshot.metadata.fromCache,
      });
      projection.publish(assets);
    },
    (error) => {
      console.error('자산 구독 오류:', error);
      if (
        queueGeneration === assetUpdateQueueGeneration
        && assetAuthoritativeStates.get(householdId) === authoritativeState
      ) {
        failAuthoritativeSubscription(
          authoritativeState,
          subscriptionId,
          'ASSET_AUTHORITATIVE_READ_FAILED'
        );
      }
      if (initialAssets === undefined) {
        projection.publish([]);
      }
    }
  );

  return () => {
    unsubscribe();
    projection.dispose();
    if (
      queueGeneration !== assetUpdateQueueGeneration
      || assetAuthoritativeStates.get(householdId) !== authoritativeState
    ) return;
    unregisterAuthoritativeSubscription(authoritativeState, subscriptionId);
  };
}

/**
 * 특정 기간의 모든 자산 이력 조회 (차트용)
 */
export async function getAssetHistoryByPeriod(
  startDate: string,
  endDate: string
): Promise<AssetHistoryEntry[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HISTORY_COLLECTION),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  const allHistory = snapshot.docs.map(mapDocToHistory);

  // 클라이언트에서 날짜 필터링
  return allHistory
    .filter((h) => h.date >= startDate && h.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 전월 말 총자산 조회 (asset_history에서 전월 마지막 TOTAL 스냅샷)
 */
export async function getPreviousMonthTotal(): Promise<number | null> {
  const householdId = getHouseholdId();
  const now = new Date();

  // 전월 마지막 날 계산
  const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const endDate = formatLocalDate(lastDayOfPrevMonth);

  // 전월 첫째 날
  const firstDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startDate = formatLocalDate(firstDayOfPrevMonth);

  try {
    // 전월의 TOTAL 스냅샷 중 가장 마지막 날짜 조회
    const q = query(
      collection(db, HISTORY_COLLECTION),
      where('householdId', '==', householdId),
      where('assetId', '==', 'TOTAL'),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'desc')
    );

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0].data().balance || null;
    }
  } catch (error) {
    console.error('전월 총자산 조회 오류:', error);
  }
  return null;
}

/**
 * 이번 달 자산 변동액 계산 (전월 대비)
 */
export async function getMonthlyAssetChange(currentTotal: number): Promise<number> {
  const previousTotal = await getPreviousMonthTotal();

  // 전월 스냅샷이 없으면 0 반환
  if (previousTotal === null) {
    return 0;
  }

  return currentTotal - previousTotal;
}

// ============================================
// 주식 보유 종목 관련 함수
// ============================================

/**
 * Firestore 문서를 StockHolding 객체로 변환
 */
function mapDocToHolding(docSnap: QueryDocumentSnapshot<DocumentData>): StockHolding {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    aggregateVersion:
      Number.isSafeInteger(data.aggregateVersion) && data.aggregateVersion > 0
        ? data.aggregateVersion
        : 1,
    assetId: data.assetId,
    householdId: data.householdId,
    holdingType: data.holdingType || 'stock',
    stockCode: data.stockCode || '',
    stockName: data.stockName,
    market:
      data.market === 'KRX' ||
      data.market === 'US' ||
      data.market === 'KOFIA_FUND'
        ? data.market
        : 'UNRESOLVED',
    quantity: data.quantity || 1,
    avgPrice: data.avgPrice,
    currentPrice: data.currentPrice,
    instrumentType: data.instrumentType,
    priceScale: data.priceScale,
    quoteAsOf: data.quoteAsOf,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
    updatedAt: timestampToDate(data.updatedAt) ?? new Date(0),
  };
}

function mapDocToCryptoHolding(docSnap: QueryDocumentSnapshot<DocumentData>): CryptoHolding {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    aggregateVersion:
      Number.isSafeInteger(data.aggregateVersion) && data.aggregateVersion > 0
        ? data.aggregateVersion
        : 1,
    assetId: data.assetId,
    householdId: data.householdId,
    marketCode: data.marketCode,
    coinName: data.coinName,
    quantity: data.quantity,
    avgPrice: data.avgPrice,
    currentPrice: data.currentPrice,
    createdAt: timestampToDate(data.createdAt) ?? new Date(0),
    updatedAt: timestampToDate(data.updatedAt) ?? new Date(0),
  };
}

/**
 * 주식 보유 종목 추가
 */
export async function addStockHolding(input: StockHoldingInput): Promise<string> {
  const householdId = getHouseholdId();
  const commandId = createHouseholdCommandId('portfolio-position-create');
  const positionId = `position-${householdId}-${commandId}`;
  const now = new Date();
  const optimisticHolding: StockHolding = {
    ...input,
    id: positionId,
    aggregateVersion: 1,
    householdId,
    holdingType: input.holdingType ?? 'stock',
    createdAt: now,
    updatedAt: now,
  };
  const mutationId = stockHoldingOptimisticProjection.beginCreate(optimisticHolding);
  try {
    const confirmedPositionId = await portfolioCommands.addPosition(
      householdId,
      'stock',
      input,
      commandId
    );
    if (confirmedPositionId !== positionId) throw new Error('POSITION_ID_CONTRACT_MISMATCH');
    stockHoldingOptimisticProjection.commitCreate(mutationId, optimisticHolding);
    return confirmedPositionId;
  } catch (error) {
    stockHoldingOptimisticProjection.rollback(mutationId);
    throw error;
  }
}

export async function addCryptoHolding(input: CryptoHoldingInput): Promise<string> {
  const householdId = getHouseholdId();
  const commandId = createHouseholdCommandId('portfolio-position-create');
  const positionId = `position-${householdId}-${commandId}`;
  const now = new Date();
  const optimisticHolding: CryptoHolding = {
    ...input,
    id: positionId,
    aggregateVersion: 1,
    householdId,
    createdAt: now,
    updatedAt: now,
  };
  const mutationId = cryptoHoldingOptimisticProjection.beginCreate(optimisticHolding);
  try {
    const confirmedPositionId = await portfolioCommands.addPosition(
      householdId,
      'crypto',
      input,
      commandId
    );
    if (confirmedPositionId !== positionId) throw new Error('POSITION_ID_CONTRACT_MISMATCH');
    cryptoHoldingOptimisticProjection.commitCreate(mutationId, optimisticHolding);
    return confirmedPositionId;
  } catch (error) {
    cryptoHoldingOptimisticProjection.rollback(mutationId);
    throw error;
  }
}

/**
 * 주식 보유 종목 수정
 */
export async function updateStockHolding(
  id: string,
  assetId: string,
  data: Partial<StockHolding>,
  expectedVersion: number,
  editBase?: StockHolding
): Promise<void> {
  const current = stockHoldingOptimisticProjection.current(id);
  if (!current) throw new Error('STOCK_POSITION_READ_MODEL_REQUIRED');
  if (current.assetId !== assetId) throw new Error('ASSET_SCOPE_MISMATCH');
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const previousMutation = stockMutationTails.get(id);
  const authoritativeState = stockAuthoritativeStates.get(householdId);
  const capturedStartupBase = capturedStartupEntity(
    authoritativeState,
    id,
    expectedVersion
  );
  const mutationBase =
    editBase?.id === id
    && editBase.aggregateVersion === expectedVersion
      ? editBase
      : capturedStartupBase ?? current;
  const effectivePatch = intendedPatch(mutationBase, current, data);
  if (!hasPatchChanges(current, effectivePatch)) return;
  const mutationId = previousMutation === undefined
    ? stockHoldingOptimisticProjection.beginUpdate(id, effectivePatch)
    : stockHoldingOptimisticProjection.beginQueuedUpdate(id, effectivePatch);
  const pendingUpdate = (async () => {
    try {
      if (previousMutation !== undefined) await previousMutation;
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }
      let commandBase = current;
      let commandExpectedVersion =
        previousMutation === undefined
          ? expectedVersion
          : current.aggregateVersion;
    if (
      authoritativeState !== undefined
      && (
        previousMutation !== undefined
        ||
        capturedStartupBase !== undefined
        || !authoritativeState.ready
        || hasNewerAuthoritativeEntity(
          authoritativeState,
          id,
          expectedVersion
        )
      )
    ) {
      const fresh = await waitForAuthoritativeEntity(
        authoritativeState,
        id,
        queueGeneration
      );
      if (!changedFieldsStillMatch(mutationBase, fresh, effectivePatch)) {
        throw new Error('ASSET_VERSION_MISMATCH');
      }
      commandBase = fresh;
      commandExpectedVersion = fresh.aggregateVersion;
    }
    try {
      await portfolioCommands.updatePosition(
        householdId,
        'stock',
        id,
        assetId,
        effectivePatch,
        commandExpectedVersion
      );
    } catch (error) {
      if (
        !isPositionVersionMismatch(error)
        || authoritativeState === undefined
      ) {
        throw error;
      }
      const fresh = await waitForAuthoritativeEntity(
        authoritativeState,
        id,
        queueGeneration,
        commandExpectedVersion
      );
      if (!changedFieldsStillMatch(mutationBase, fresh, effectivePatch)) {
        throw new Error('ASSET_VERSION_MISMATCH');
      }
      commandBase = fresh;
      commandExpectedVersion = fresh.aggregateVersion;
      await portfolioCommands.updatePosition(
        householdId,
        'stock',
        id,
        assetId,
        effectivePatch,
        commandExpectedVersion
      );
    }
      const canonical = {
        ...commandBase,
        ...effectivePatch,
        aggregateVersion: commandExpectedVersion + 1,
        updatedAt: new Date(),
      };
      if (queueGeneration === assetUpdateQueueGeneration) {
        recordCommandFloor(stockAuthoritativeStates, householdId, canonical);
        stockHoldingOptimisticProjection.commitUpdate(mutationId, canonical);
      }
    } catch (error) {
      stockHoldingOptimisticProjection.rollback(mutationId);
      throw error;
    }
  })();
  stockMutationTails.set(id, pendingUpdate);
  const clearTail = () => {
    if (stockMutationTails.get(id) === pendingUpdate) {
      stockMutationTails.delete(id);
    }
  };
  void pendingUpdate.then(clearTail, clearTail);
  await pendingUpdate;
}

export async function updateCryptoHolding(
  id: string,
  assetId: string,
  data: Partial<CryptoHolding>,
  expectedVersion: number,
  editBase?: CryptoHolding
): Promise<void> {
  const current = cryptoHoldingOptimisticProjection.current(id);
  if (!current) throw new Error('CRYPTO_POSITION_READ_MODEL_REQUIRED');
  if (current.assetId !== assetId) throw new Error('ASSET_SCOPE_MISMATCH');
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const previousMutation = cryptoMutationTails.get(id);
  const authoritativeState = cryptoAuthoritativeStates.get(householdId);
  const capturedStartupBase = capturedStartupEntity(
    authoritativeState,
    id,
    expectedVersion
  );
  const mutationBase =
    editBase?.id === id
    && editBase.aggregateVersion === expectedVersion
      ? editBase
      : capturedStartupBase ?? current;
  const effectivePatch = intendedPatch(mutationBase, current, data);
  if (!hasPatchChanges(current, effectivePatch)) return;
  const mutationId = previousMutation === undefined
    ? cryptoHoldingOptimisticProjection.beginUpdate(id, effectivePatch)
    : cryptoHoldingOptimisticProjection.beginQueuedUpdate(id, effectivePatch);
  const pendingUpdate = (async () => {
    try {
      if (previousMutation !== undefined) await previousMutation;
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }
      let commandBase = current;
      let commandExpectedVersion =
        previousMutation === undefined
          ? expectedVersion
          : current.aggregateVersion;
    if (
      authoritativeState !== undefined
      && (
        previousMutation !== undefined
        ||
        capturedStartupBase !== undefined
        || !authoritativeState.ready
        || hasNewerAuthoritativeEntity(
          authoritativeState,
          id,
          expectedVersion
        )
      )
    ) {
      const fresh = await waitForAuthoritativeEntity(
        authoritativeState,
        id,
        queueGeneration
      );
      if (!changedFieldsStillMatch(mutationBase, fresh, effectivePatch)) {
        throw new Error('ASSET_VERSION_MISMATCH');
      }
      commandBase = fresh;
      commandExpectedVersion = fresh.aggregateVersion;
    }
    try {
      await portfolioCommands.updatePosition(
        householdId,
        'crypto',
        id,
        assetId,
        effectivePatch,
        commandExpectedVersion
      );
    } catch (error) {
      if (
        !isPositionVersionMismatch(error)
        || authoritativeState === undefined
      ) {
        throw error;
      }
      const fresh = await waitForAuthoritativeEntity(
        authoritativeState,
        id,
        queueGeneration,
        commandExpectedVersion
      );
      if (!changedFieldsStillMatch(mutationBase, fresh, effectivePatch)) {
        throw new Error('ASSET_VERSION_MISMATCH');
      }
      commandBase = fresh;
      commandExpectedVersion = fresh.aggregateVersion;
      await portfolioCommands.updatePosition(
        householdId,
        'crypto',
        id,
        assetId,
        effectivePatch,
        commandExpectedVersion
      );
    }
      const canonical = {
        ...commandBase,
        ...effectivePatch,
        aggregateVersion: commandExpectedVersion + 1,
        updatedAt: new Date(),
      };
      if (queueGeneration === assetUpdateQueueGeneration) {
        recordCommandFloor(cryptoAuthoritativeStates, householdId, canonical);
        cryptoHoldingOptimisticProjection.commitUpdate(mutationId, canonical);
      }
    } catch (error) {
      cryptoHoldingOptimisticProjection.rollback(mutationId);
      throw error;
    }
  })();
  cryptoMutationTails.set(id, pendingUpdate);
  const clearTail = () => {
    if (cryptoMutationTails.get(id) === pendingUpdate) {
      cryptoMutationTails.delete(id);
    }
  };
  void pendingUpdate.then(clearTail, clearTail);
  await pendingUpdate;
}

/**
 * 주식 보유 종목 삭제
 */
export async function deleteStockHolding(
  id: string,
  assetId: string,
  expectedVersion: number,
  editBase?: StockHolding
): Promise<void> {
  const current = stockHoldingOptimisticProjection.current(id);
  if (!current) throw new Error('STOCK_POSITION_READ_MODEL_REQUIRED');
  if (current.assetId !== assetId) throw new Error('ASSET_SCOPE_MISMATCH');
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const previousMutation = stockMutationTails.get(id);
  const authoritativeState = stockAuthoritativeStates.get(householdId);
  const capturedStartupBase = capturedStartupEntity(
    authoritativeState,
    id,
    expectedVersion
  );
  const mutationBase =
    editBase?.id === id
    && editBase.aggregateVersion === expectedVersion
      ? editBase
      : capturedStartupBase ?? current;
  const mutationId = previousMutation === undefined
    ? stockHoldingOptimisticProjection.beginDelete(id)
    : stockHoldingOptimisticProjection.beginQueuedDelete(id);
  const pendingDelete = (async () => {
    try {
      if (previousMutation !== undefined) await previousMutation;
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }
      let commandExpectedVersion =
        previousMutation === undefined
          ? expectedVersion
          : current.aggregateVersion;
      if (
        authoritativeState !== undefined
        && (
          previousMutation !== undefined
          || capturedStartupBase !== undefined
          || !authoritativeState.ready
          || hasNewerAuthoritativeEntity(
            authoritativeState,
            id,
            expectedVersion
          )
        )
      ) {
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration
        );
        if (!sameEntityContent(mutationBase, fresh)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandExpectedVersion = fresh.aggregateVersion;
      }
      try {
        await portfolioCommands.deletePosition(
          householdId,
          'stock',
          id,
          assetId,
          commandExpectedVersion
        );
      } catch (error) {
        if (
          !isPositionVersionMismatch(error)
          || authoritativeState === undefined
        ) {
          throw error;
        }
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration,
          commandExpectedVersion
        );
        if (!sameEntityContent(mutationBase, fresh)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandExpectedVersion = fresh.aggregateVersion;
        await portfolioCommands.deletePosition(
          householdId,
          'stock',
          id,
          assetId,
          commandExpectedVersion
        );
      }
      if (queueGeneration === assetUpdateQueueGeneration) {
        stockHoldingOptimisticProjection.commitDelete(mutationId);
      }
    } catch (error) {
      stockHoldingOptimisticProjection.rollback(mutationId);
      throw error;
    }
  })();
  stockMutationTails.set(id, pendingDelete);
  const clearTail = () => {
    if (stockMutationTails.get(id) === pendingDelete) {
      stockMutationTails.delete(id);
    }
  };
  void pendingDelete.then(clearTail, clearTail);
  await pendingDelete;
}

export async function deleteCryptoHolding(
  id: string,
  assetId: string,
  expectedVersion: number,
  editBase?: CryptoHolding
): Promise<void> {
  const current = cryptoHoldingOptimisticProjection.current(id);
  if (!current) throw new Error('CRYPTO_POSITION_READ_MODEL_REQUIRED');
  if (current.assetId !== assetId) throw new Error('ASSET_SCOPE_MISMATCH');
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const previousMutation = cryptoMutationTails.get(id);
  const authoritativeState = cryptoAuthoritativeStates.get(householdId);
  const capturedStartupBase = capturedStartupEntity(
    authoritativeState,
    id,
    expectedVersion
  );
  const mutationBase =
    editBase?.id === id
    && editBase.aggregateVersion === expectedVersion
      ? editBase
      : capturedStartupBase ?? current;
  const mutationId = previousMutation === undefined
    ? cryptoHoldingOptimisticProjection.beginDelete(id)
    : cryptoHoldingOptimisticProjection.beginQueuedDelete(id);
  const pendingDelete = (async () => {
    try {
      if (previousMutation !== undefined) await previousMutation;
      if (queueGeneration !== assetUpdateQueueGeneration) {
        throw new Error('CLIENT_SESSION_RESET');
      }
      let commandExpectedVersion =
        previousMutation === undefined
          ? expectedVersion
          : current.aggregateVersion;
      if (
        authoritativeState !== undefined
        && (
          previousMutation !== undefined
          || capturedStartupBase !== undefined
          || !authoritativeState.ready
          || hasNewerAuthoritativeEntity(
            authoritativeState,
            id,
            expectedVersion
          )
        )
      ) {
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration
        );
        if (!sameEntityContent(mutationBase, fresh)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandExpectedVersion = fresh.aggregateVersion;
      }
      try {
        await portfolioCommands.deletePosition(
          householdId,
          'crypto',
          id,
          assetId,
          commandExpectedVersion
        );
      } catch (error) {
        if (
          !isPositionVersionMismatch(error)
          || authoritativeState === undefined
        ) {
          throw error;
        }
        const fresh = await waitForAuthoritativeEntity(
          authoritativeState,
          id,
          queueGeneration,
          commandExpectedVersion
        );
        if (!sameEntityContent(mutationBase, fresh)) {
          throw new Error('ASSET_VERSION_MISMATCH');
        }
        commandExpectedVersion = fresh.aggregateVersion;
        await portfolioCommands.deletePosition(
          householdId,
          'crypto',
          id,
          assetId,
          commandExpectedVersion
        );
      }
      if (queueGeneration === assetUpdateQueueGeneration) {
        cryptoHoldingOptimisticProjection.commitDelete(mutationId);
      }
    } catch (error) {
      cryptoHoldingOptimisticProjection.rollback(mutationId);
      throw error;
    }
  })();
  cryptoMutationTails.set(id, pendingDelete);
  const clearTail = () => {
    if (cryptoMutationTails.get(id) === pendingDelete) {
      cryptoMutationTails.delete(id);
    }
  };
  void pendingDelete.then(clearTail, clearTail);
  await pendingDelete;
}

/**
 * 현재 가구의 모든 주식 보유 종목 실시간 구독
 */
export function subscribeToHouseholdStockHoldings(
  callback: (holdings: StockHolding[]) => void
): () => void {
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const authoritativeState = getOrCreateAuthoritativeState(
    stockAuthoritativeStates,
    householdId
  );
  const subscriptionId =
    registerAuthoritativeSubscription(authoritativeState);
  let capturingRetainedSnapshot = true;
  const projection = stockHoldingOptimisticProjection.subscribe(
    (holdings) => {
      if (capturingRetainedSnapshot) {
        captureStartupEntities(authoritativeState, holdings);
      }
      callback(holdings);
    },
    (holding) => holding.householdId === householdId,
    `stock-holdings:${householdId}`
  );
  capturingRetainedSnapshot = false;

  const q = query(
    collection(db, HOLDINGS_COLLECTION),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (
        queueGeneration !== assetUpdateQueueGeneration
        || stockAuthoritativeStates.get(householdId) !== authoritativeState
      ) return;
      const holdings = snapshot.docs.map(mapDocToHolding);
      holdings.sort((a, b) => a.stockName.localeCompare(b.stockName));
      if (snapshot.metadata.fromCache) {
        captureStartupEntities(authoritativeState, holdings);
      } else {
        publishAuthoritativeEntities(
          authoritativeState,
          subscriptionId,
          holdings
        );
      }
      projection.publish(holdings);
    },
    (error) => {
      console.error('보유 종목 구독 오류:', error);
      if (
        queueGeneration === assetUpdateQueueGeneration
        && stockAuthoritativeStates.get(householdId) === authoritativeState
      ) {
        failAuthoritativeSubscription(
          authoritativeState,
          subscriptionId,
          'ASSET_AUTHORITATIVE_READ_FAILED'
        );
      }
      projection.publish([]);
    }
  );

  return () => {
    unsubscribe();
    projection.dispose();
    if (
      queueGeneration === assetUpdateQueueGeneration
      && stockAuthoritativeStates.get(householdId) === authoritativeState
    ) {
      unregisterAuthoritativeSubscription(
        authoritativeState,
        subscriptionId
      );
    }
  };
}

/**
 * 현재 가구의 모든 코인 보유 종목 실시간 구독
 */
export function subscribeToHouseholdCryptoHoldings(
  callback: (holdings: CryptoHolding[]) => void
): () => void {
  const householdId = getHouseholdId();
  const queueGeneration = assetUpdateQueueGeneration;
  const authoritativeState = getOrCreateAuthoritativeState(
    cryptoAuthoritativeStates,
    householdId
  );
  const subscriptionId =
    registerAuthoritativeSubscription(authoritativeState);
  let capturingRetainedSnapshot = true;
  const projection = cryptoHoldingOptimisticProjection.subscribe(
    (holdings) => {
      if (capturingRetainedSnapshot) {
        captureStartupEntities(authoritativeState, holdings);
      }
      callback(holdings);
    },
    (holding) => holding.householdId === householdId,
    `crypto-holdings:${householdId}`
  );
  capturingRetainedSnapshot = false;

  const q = query(
    collection(db, CRYPTO_HOLDINGS_COLLECTION),
    where('householdId', '==', householdId)
  );

  const unsubscribe = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (
        queueGeneration !== assetUpdateQueueGeneration
        || cryptoAuthoritativeStates.get(householdId) !== authoritativeState
      ) return;
      const holdings = snapshot.docs.map(mapDocToCryptoHolding);
      holdings.sort((a, b) => a.coinName.localeCompare(b.coinName));
      if (snapshot.metadata.fromCache) {
        captureStartupEntities(authoritativeState, holdings);
      } else {
        publishAuthoritativeEntities(
          authoritativeState,
          subscriptionId,
          holdings
        );
      }
      projection.publish(holdings);
    },
    (error) => {
      console.error('코인 보유내역 구독 오류:', error);
      if (
        queueGeneration === assetUpdateQueueGeneration
        && cryptoAuthoritativeStates.get(householdId) === authoritativeState
      ) {
        failAuthoritativeSubscription(
          authoritativeState,
          subscriptionId,
          'ASSET_AUTHORITATIVE_READ_FAILED'
        );
      }
      projection.publish([]);
    }
  );

  return () => {
    unsubscribe();
    projection.dispose();
    if (
      queueGeneration === assetUpdateQueueGeneration
      && cryptoAuthoritativeStates.get(householdId) === authoritativeState
    ) {
      unregisterAuthoritativeSubscription(
        authoritativeState,
        subscriptionId
      );
    }
  };
}

// ============================================
// 배당금 스냅샷 관련 함수
// ============================================

const DIVIDEND_COLLECTION = 'dividend_snapshots';
const DIVIDEND_EVENTS_COLLECTION = 'dividend_events';

export interface DividendSnapshotEventRecord {
  stockCode: string;
  stockName: string;
  paymentDate: string;
  perShareAmount: number;
  quantity: number;
  totalAmount: number;
}

export interface DividendSnapshotData {
  monthlyData: number[];
  events: Record<string, DividendSnapshotEventRecord>;
}

export interface DividendEventRecord {
  id: string;
  householdId: string;
  stockCode: string;
  stockName: string;
  recordDate: string;
  paymentDate: string;
  paymentYear: number | null;
  perShareAmount: number;
  eligibleQuantity: number | null;
  totalAmount: number | null;
  status: string;
}

function createEmptyDividendMonthlyData() {
  return Array.from({ length: 12 }, () => 0);
}

function normalizeDividendSnapshotData(data?: DocumentData | null): DividendSnapshotData {
  const monthlyData = Array.isArray(data?.monthlyData)
    ? [...data.monthlyData, ...createEmptyDividendMonthlyData()].slice(0, 12).map((value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      })
    : createEmptyDividendMonthlyData();

  const events = data?.events && typeof data.events === 'object' ? data.events : {};

  return {
    monthlyData,
    events,
  };
}

function mapDocToDividendEvent(docSnap: QueryDocumentSnapshot<DocumentData>): DividendEventRecord {
  const data = docSnap.data();
  const paymentDate = String(data.paymentDate || '');

  return {
    id: docSnap.id,
    householdId: data.householdId,
    stockCode: String(data.stockCode || '').trim().toUpperCase(),
    stockName: data.stockName || data.stockCode || '',
    recordDate: String(data.recordDate || ''),
    paymentDate,
    paymentYear:
      typeof data.paymentYear === 'number'
        ? data.paymentYear
        : Number(paymentDate.slice(0, 4)) || null,
    perShareAmount: Number(data.perShareAmount || 0),
    eligibleQuantity: typeof data.eligibleQuantity === 'number' ? data.eligibleQuantity : null,
    totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : null,
    status: String(data.status || ''),
  };
}

function buildDividendMonthlyDataFromEvents(
  events: Record<string, DividendSnapshotEventRecord>
): number[] {
  const monthlyData = createEmptyDividendMonthlyData();

  Object.values(events).forEach((event) => {
    const [year, month] = event.paymentDate.split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) {
      return;
    }

    monthlyData[month - 1] += event.totalAmount;
  });

  return monthlyData.map((amount) => Math.round(amount));
}


/**
 * 연도별 배당금 스냅샷 조회
 */
export async function getDividendSnapshot(year: number): Promise<DividendSnapshotData | null> {
  const householdId = getHouseholdId();
  const docId = `${householdId}_${year}`;

  try {
    const docSnap = await getDoc(doc(db, DIVIDEND_COLLECTION, docId));
    if (docSnap.exists()) {
      return normalizeDividendSnapshotData(docSnap.data());
    }
  } catch (error) {
    console.error('배당금 스냅샷 조회 오류:', error);
  }
  return null;
}

export async function getDividendEventsByYear(year: number): Promise<DividendEventRecord[]> {
  const householdId = getHouseholdId();

  try {
    const q = query(
      collection(db, DIVIDEND_EVENTS_COLLECTION),
      where('householdId', '==', householdId)
    );
    const snapshot = await getDocs(q);

    return snapshot.docs
      .map(mapDocToDividendEvent)
      .filter((event) => event.paymentYear === year)
      .sort((left, right) => {
        if (left.paymentDate !== right.paymentDate) {
          return right.paymentDate.localeCompare(left.paymentDate);
        }

        return left.stockName.localeCompare(right.stockName, 'ko');
      });
  } catch (error) {
    console.error('배당금 이벤트 조회 오류:', error);
    return [];
  }
}

/**
 * 모든 주식 보유 종목 조회 (배당금 계산용)
 */
export async function getAllStockHoldings(): Promise<StockHolding[]> {
  const householdId = getHouseholdId();

  const q = query(
    collection(db, HOLDINGS_COLLECTION),
    where('householdId', '==', householdId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDocToHolding);
}

const refreshAllMarketValuesInFlight = new Map<string, Promise<void>>();

export function refreshAllMarketValues(): Promise<void> {
  const householdId = getHouseholdId();
  const existing = refreshAllMarketValuesInFlight.get(householdId);
  if (existing) return existing;

  const inFlight = portfolioCommands
    .refreshMarketValues(householdId, 'all')
    .then(() => undefined)
    .finally(() => {
      if (refreshAllMarketValuesInFlight.get(householdId) === inFlight) {
        refreshAllMarketValuesInFlight.delete(householdId);
      }
    });
  refreshAllMarketValuesInFlight.set(householdId, inFlight);
  return inFlight;
}

export async function refreshAssetMarketValues(
  assetId: string,
  assetClass: 'stock' | 'crypto' | 'physical-gold'
): Promise<void> {
  await portfolioCommands.refreshMarketValues(getHouseholdId(), assetClass, assetId);
}

export async function refreshAllPhysicalGoldValues(): Promise<void> {
  await portfolioCommands.refreshMarketValues(getHouseholdId(), 'physical-gold');
}
