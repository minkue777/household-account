export type AdminDashboardHealth = "healthy" | "degraded" | "critical";

export interface AdminDashboardDailyAccess {
  readonly date: string;
  readonly count: number;
}

export interface AdminDashboardMemberActivity {
  readonly memberId: string;
  readonly displayName: string;
  readonly lifecycleState: "active" | "removed";
  readonly linkedPrincipal: boolean;
  readonly totalAccessCount: number;
  readonly todayAccessCount: number;
  readonly lastAccessAt?: string;
  readonly dailyAccess: readonly AdminDashboardDailyAccess[];
}

export interface AdminDashboardHouseholdActivity {
  readonly householdId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lifecycleState: "active" | "deleted";
  readonly aggregateVersion: number;
  readonly memberCount: number;
  readonly totalAccessCount: number;
  readonly todayAccessCount: number;
  readonly lastAccessAt?: string;
  readonly members: readonly AdminDashboardMemberActivity[];
}

export interface AdminDashboardScheduledJob {
  readonly jobName: string;
  readonly cron: string;
  readonly latestStatus:
    | "UNKNOWN"
    | "EXPECTED"
    | "RUNNING"
    | "MISSING"
    | "OVERDUE"
    | "COMPLETE"
    | "PARTIAL_FAILURE"
    | "FAILED";
  readonly scheduledFor?: string;
  readonly lastUpdatedAt?: string;
  readonly totals?: {
    readonly target: number;
    readonly succeeded: number;
    readonly skipped: number;
    readonly failed: number;
  };
}

export interface AdminDashboardProviderHealth {
  readonly provider: string;
  readonly operation: string;
  readonly status: "healthy" | "degraded" | "outage";
  readonly lastAttemptAt: string;
  readonly lastSuccessAt?: string;
  readonly consecutiveFailedRuns: number;
  readonly lastResultKind: string;
  readonly lastErrorCode?: string;
  readonly alertState: "closed" | "open";
}

export interface AdminDashboardIncident {
  readonly incidentId: string;
  readonly occurrenceId: string;
  readonly reason: string;
  readonly openedAt: string;
}

export interface AdminOperationsDashboard {
  readonly generatedAt: string;
  readonly service: {
    readonly apiStatus: "online";
    readonly health: AdminDashboardHealth;
    readonly serviceName: string;
    readonly revision: string;
    readonly region: string;
  };
  readonly summary: {
    readonly activeHouseholds: number;
    readonly deletedHouseholds: number;
    readonly activeMembers: number;
    readonly todayAccessCount: number;
    readonly totalAccessCount: number;
    readonly unhealthyProviders: number;
    readonly openIncidents: number;
  };
  readonly dailyAccess: readonly AdminDashboardDailyAccess[];
  readonly households: readonly AdminDashboardHouseholdActivity[];
  readonly scheduledJobs: readonly AdminDashboardScheduledJob[];
  readonly providerHealth: readonly AdminDashboardProviderHealth[];
  readonly incidents: readonly AdminDashboardIncident[];
}
