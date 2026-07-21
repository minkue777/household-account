import type { RefreshRunView } from "../in/hardenedIngressInputPort";

export interface RefreshIngressActor {
  readonly actorId: string;
  readonly householdId: string;
}

export interface RefreshIngressAuthPort {
  verify(token: string | undefined): Promise<RefreshIngressActor | undefined>;
}

export interface RefreshIngressAppCheckPort {
  verify(token: string | undefined): Promise<boolean>;
}

export interface RefreshIngressQuotaPort {
  rateAvailable(actorId: string, requestedAt: string): Promise<boolean>;
  costAvailable(actorId: string, householdId: string): Promise<boolean>;
}

export interface RefreshTargetSourcePort {
  activeTargetIds(householdId: string): Promise<readonly string[]>;
}

export interface RefreshRunRepositoryPort {
  findReusable(input: {
    readonly actorId: string;
    readonly householdId: string;
    readonly scope: "market.refresh";
    readonly requestedAt: string;
    readonly windowSeconds: number;
  }): Promise<RefreshRunView | undefined>;
  save(input: {
    readonly actorId: string;
    readonly scope: "market.refresh";
    readonly run: RefreshRunView;
  }): Promise<void>;
}

export interface RefreshRunIdentityPort {
  next(): string;
}
