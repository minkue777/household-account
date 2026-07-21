export interface ClientSessionScope {
  sessionGeneration: number;
  principalUid: string;
  householdId: string;
  memberId: string;
}

let activeScope: ClientSessionScope | undefined;

export function setClientSessionScope(scope: ClientSessionScope): void {
  activeScope = Object.freeze({ ...scope });
}

export function clearClientSessionScope(): void {
  activeScope = undefined;
}

export function getClientSessionScope(): ClientSessionScope | undefined {
  return activeScope;
}

export function requireClientSessionScope(): ClientSessionScope {
  if (!activeScope) {
    throw new Error('인증된 가구 세션이 필요합니다.');
  }
  return activeScope;
}
