export interface ClientSessionScope {
  readonly sessionGeneration: number;
  readonly principalUid: string;
  readonly householdId: string;
  readonly memberId: string;
}

export interface ClientSessionState {
  readonly scope?: ClientSessionScope;
  readonly cachedKeys: readonly string[];
  readonly activeSubscriptions: readonly string[];
  readonly renderedRecordIds: readonly string[];
  readonly writes: readonly { householdId: string; recordId: string }[];
  readonly externalEffects: readonly string[];
}

export function sameSessionScope(
  left: ClientSessionScope | undefined,
  right: ClientSessionScope,
): boolean {
  return (
    left?.sessionGeneration === right.sessionGeneration &&
    left.principalUid === right.principalUid &&
    left.householdId === right.householdId &&
    left.memberId === right.memberId
  );
}

export function emptyClientSessionState(): ClientSessionState {
  return {
    cachedKeys: [],
    activeSubscriptions: [],
    renderedRecordIds: [],
    writes: [],
    externalEffects: [],
  };
}
