export interface VersionedEntity {
  readonly id: string;
  readonly aggregateVersion: number;
}

interface ProjectionSubscription<Entity extends VersionedEntity> {
  base: Entity[];
  hasPublished: boolean;
  revision: number;
  readonly accept: (entity: Entity) => boolean;
  readonly callback: (entities: Entity[]) => void;
}

interface PendingMutation<Entity extends VersionedEntity> {
  readonly entityId: string;
  readonly kind: 'create' | 'update' | 'delete';
  readonly patch?: Partial<Entity>;
  readonly observedBy: ReadonlySet<number>;
  readonly subscriptionRevisionAtBegin: ReadonlyMap<number, number>;
  readonly original?: Entity;
  canonical?: Entity;
  committed: boolean;
}

export interface OptimisticProjectionSubscription<Entity> {
  publish(entities: readonly Entity[]): void;
  dispose(): void;
}

function operationId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/** 서버 권위형 command와 실시간 read model 사이의 지연만 가리는 공통 projection store입니다. */
export class OptimisticEntityProjection<Entity extends VersionedEntity> {
  private nextSubscriptionId = 1;
  private readonly subscriptions = new Map<number, ProjectionSubscription<Entity>>();
  private readonly pending = new Map<string, PendingMutation<Entity>>();

  constructor(
    private readonly prefix: string,
    private readonly compare: (left: Entity, right: Entity) => number
  ) {}

  subscribe(
    callback: (entities: Entity[]) => void,
    accept: (entity: Entity) => boolean = () => true
  ): OptimisticProjectionSubscription<Entity> {
    const subscriptionId = this.nextSubscriptionId++;
    this.subscriptions.set(subscriptionId, {
      base: [],
      hasPublished: false,
      revision: 0,
      accept,
      callback,
    });
    return {
      publish: (entities) => {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) return;
        subscription.base = [...entities];
        subscription.hasPublished = true;
        subscription.revision += 1;
        this.reconcile();
        this.emitAll();
      },
      dispose: () => {
        this.subscriptions.delete(subscriptionId);
        this.reconcile();
        this.emitAll();
      },
    };
  }

  current(entityId: string): Entity | undefined {
    const candidates = Array.from(this.subscriptions.values())
      .flatMap(({ base }) => base)
      .filter((entity) => entity.id === entityId);
    Array.from(this.pending.values())
      .filter((mutation) => mutation.entityId === entityId)
      .forEach((mutation) => {
        if (mutation.original) candidates.push(mutation.original);
        if (mutation.canonical) candidates.push(mutation.canonical);
      });
    const base = candidates.sort(
      (left, right) => right.aggregateVersion - left.aggregateVersion
    )[0];
    return base ? this.applyMutations([base])[0] : undefined;
  }

  beginUpdate(entityId: string, patch: Partial<Entity>): string {
    return this.begin({ entityId, kind: 'update', patch });
  }

  beginCreate(entity: Entity): string {
    if (this.current(entity.id) !== undefined) {
      throw new Error(`${this.prefix.toUpperCase()}_ENTITY_ALREADY_EXISTS`);
    }
    return this.begin({ entityId: entity.id, kind: 'create', canonical: entity });
  }

  beginDelete(entityId: string): string {
    return this.begin({ entityId, kind: 'delete' });
  }

  commitUpdate(id: string, canonical: Entity): void {
    const mutation = this.pending.get(id);
    if (!mutation) return;
    mutation.committed = true;
    mutation.canonical = canonical;
    this.reconcile();
    this.emitAll();
  }

  commitCreate(id: string, canonical: Entity): void {
    this.commitUpdate(id, canonical);
  }

  commitDelete(id: string): void {
    const mutation = this.pending.get(id);
    if (!mutation) return;
    mutation.committed = true;
    this.reconcile();
    this.emitAll();
  }

  rollback(id: string): void {
    if (!this.pending.delete(id)) return;
    this.emitAll();
  }

  reset(): void {
    this.pending.clear();
    this.subscriptions.clear();
    this.nextSubscriptionId = 1;
  }

  private begin(input: {
    entityId: string;
    kind: PendingMutation<Entity>['kind'];
    patch?: Partial<Entity>;
    canonical?: Entity;
  }): string {
    const existingMutations = Array.from(this.pending.values())
      .filter(({ entityId }) => entityId === input.entityId);
    if (
      existingMutations.some(({ committed }) => !committed)
      || existingMutations.at(-1)?.kind === 'delete'
    ) {
      throw new Error(`${this.prefix.toUpperCase()}_MUTATION_ALREADY_PENDING`);
    }
    const original = this.current(input.entityId);
    const id = operationId(`${this.prefix}-optimistic`);
    const observedBy = new Set<number>();
    const subscriptionRevisionAtBegin = new Map<number, number>();
    this.subscriptions.forEach((subscription, subscriptionId) => {
      subscriptionRevisionAtBegin.set(subscriptionId, subscription.revision);
      if (
        subscription.base.some(
          (entity) => entity.id === input.entityId && subscription.accept(entity)
        )
      ) {
        observedBy.add(subscriptionId);
      }
    });
    this.pending.set(id, {
      entityId: input.entityId,
      kind: input.kind,
      ...(input.patch ? { patch: input.patch } : {}),
      ...(input.canonical ? { canonical: input.canonical } : {}),
      ...(original ? { original } : {}),
      observedBy,
      subscriptionRevisionAtBegin,
      committed: false,
    });
    this.emitAll();
    return id;
  }

  private reconcile(): void {
    this.pending.forEach((mutation, id) => {
      if (!mutation.committed) return;
      if ((mutation.kind === 'create' || mutation.kind === 'update') && mutation.canonical) {
        const relevantSubscriptions = Array.from(this.subscriptions.entries())
          .filter(([subscriptionId, { accept }]) => {
            if (mutation.kind === 'create') return accept(mutation.canonical!);
            return mutation.observedBy.has(subscriptionId)
              || (mutation.original !== undefined && accept(mutation.original))
              || accept(mutation.canonical!);
          });
        // 화면 이동으로 기존 구독이 잠시 사라졌다고 해서 서버 반영이 확인된 것은
        // 아닙니다. overlay를 유지해야 재진입 시 오래된 cache snapshot이 확정값을
        // 잠깐 되돌리지 않습니다. 새 구독의 fresh snapshot이 실제 확정을 담당합니다.
        if (relevantSubscriptions.length === 0) return;
        const confirmed = relevantSubscriptions.every(([
          subscriptionId,
          { base, hasPublished, accept, revision },
        ]) => {
          if (!hasPublished) return false;
          const current = base.find((entity) => entity.id === mutation.entityId);
          if (accept(mutation.canonical!)) {
            return current !== undefined
              && current.aggregateVersion >= mutation.canonical!.aggregateVersion;
          }
          if (!current) {
            const revisionAtBegin = mutation.subscriptionRevisionAtBegin.get(subscriptionId);
            return revisionAtBegin === undefined || revision > revisionAtBegin;
          }
          return current.aggregateVersion >= mutation.canonical!.aggregateVersion
            && !accept(current);
        });
        // A source query can legitimately stop containing an entity when an update moves it
        // into another query (for example, July -> August).  Absence from that source is not
        // proof that a cached destination query has observed the successful write.  Keep the
        // committed floor until at least one subscription has actually seen the canonical (or
        // a newer) entity; otherwise a route unsubscribe/resubscribe can resurrect stale data.
        const canonicalOrNewerObserved = Array.from(this.subscriptions.values()).some(
          ({ base }) => base.some(
            (entity) => entity.id === mutation.entityId
              && entity.aggregateVersion >= mutation.canonical!.aggregateVersion
          )
        );
        if (confirmed && canonicalOrNewerObserved) this.pending.delete(id);
        return;
      }
      if (mutation.kind === 'delete') {
        const observedSubscriptions = Array.from(this.subscriptions.entries()).filter(
          ([subscriptionId, subscription]) => {
            return mutation.observedBy.has(subscriptionId)
              || (mutation.original !== undefined && subscription.accept(mutation.original));
          }
        );
        if (observedSubscriptions.length === 0) return;
        const confirmed = observedSubscriptions.every(([subscriptionId, subscription]) => {
          const revisionAtBegin = mutation.subscriptionRevisionAtBegin.get(subscriptionId);
          // A subscription created after the mutation can emit an incomplete persistent-cache
          // snapshot first. Absence in that first emission is not deletion confirmation. A
          // second emission (normally the server snapshot) may confirm it; an already-observed
          // subscription only needs a revision newer than the mutation.
          const hasFreshSnapshot = revisionAtBegin === undefined
            ? subscription.revision > 1
            : subscription.revision > revisionAtBegin;
          return subscription.hasPublished
            && hasFreshSnapshot
            && !subscription.base.some((entity) => entity.id === mutation.entityId);
        });
        if (confirmed) {
          this.pending.forEach((candidate, candidateId) => {
            if (candidate.entityId === mutation.entityId) this.pending.delete(candidateId);
          });
        }
      }
    });
  }

  private applyMutations(base: readonly Entity[]): Entity[] {
    let projected = [...base];
    this.pending.forEach((mutation) => {
      if (mutation.kind === 'create') {
        if (
          mutation.canonical
          && !projected.some((entity) => entity.id === mutation.entityId)
        ) {
          projected = [...projected, mutation.canonical];
        }
        return;
      }
      if (mutation.kind === 'delete') {
        projected = projected.filter((entity) => entity.id !== mutation.entityId);
        return;
      }

      const currentIndex = projected.findIndex((entity) => entity.id === mutation.entityId);
      const current = currentIndex >= 0 ? projected[currentIndex] : undefined;
      const source = (current === undefined
        ? mutation.original
        : mutation.original === undefined
          ? current
          : current.aggregateVersion >= mutation.original.aggregateVersion
            ? current
            : mutation.original) ?? mutation.canonical;
      if (!source) return;

      const next = mutation.canonical === undefined
        ? { ...source, ...mutation.patch }
        : current !== undefined
          && current.aggregateVersion > mutation.canonical.aggregateVersion
            ? current
            : mutation.canonical;
      if (currentIndex >= 0) {
        projected[currentIndex] = next;
      } else {
        projected.push(next);
      }
    });
    return projected;
  }

  private emitAll(): void {
    this.subscriptions.forEach((subscription) => {
      subscription.callback(
        this.applyMutations(subscription.base)
          .filter(subscription.accept)
          .sort(this.compare)
      );
    });
  }
}
