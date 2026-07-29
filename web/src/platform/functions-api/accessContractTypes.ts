import type { AssetOwnerProfileView } from '@/features/access-household/domain/assetOwnerProfile';

export type AssetOwnerProfileWireView = AssetOwnerProfileView;

export interface AdminHouseholdWireView {
  householdId: string;
  name: string;
  createdAt: string;
  lifecycleState: 'active' | 'deleted';
  aggregateVersion: number;
  legacyShareKey?: string;
}

export interface AdminMemberWireView {
  memberId: string;
  displayName: string;
  lifecycleState: 'active' | 'removed';
  aggregateVersion: number;
  linkedPrincipal: boolean;
}

export interface AdminDeletedAssetWireView {
  assetId: string;
  name: string;
  lifecycleState: 'deleted';
  aggregateVersion: number;
  deletedAt?: string;
}

export interface AdminDashboardDailyAccess {
  date: string;
  count: number;
}

export interface AdminDashboardMemberActivity {
  memberId: string;
  displayName: string;
  lifecycleState: 'active' | 'removed';
  linkedPrincipal: boolean;
  totalAccessCount: number;
  todayAccessCount: number;
  lastAccessAt?: string;
  dailyAccess: AdminDashboardDailyAccess[];
}

export interface AdminDashboardHouseholdActivity extends AdminHouseholdWireView {
  memberCount: number;
  totalAccessCount: number;
  todayAccessCount: number;
  lastAccessAt?: string;
  members: AdminDashboardMemberActivity[];
}

export interface AdminOperationsDashboardWireView {
  generatedAt: string;
  service: {
    apiStatus: 'online';
    health: 'healthy' | 'degraded' | 'critical';
    serviceName: string;
    revision: string;
    region: string;
  };
  summary: {
    activeHouseholds: number;
    deletedHouseholds: number;
    activeMembers: number;
    todayAccessCount: number;
    totalAccessCount: number;
    unhealthyProviders: number;
    openIncidents: number;
  };
  dailyAccess: AdminDashboardDailyAccess[];
  households: AdminDashboardHouseholdActivity[];
  scheduledJobs: Array<{
    jobName: string;
    cron: string;
    latestStatus:
      | 'UNKNOWN'
      | 'EXPECTED'
      | 'RUNNING'
      | 'MISSING'
      | 'OVERDUE'
      | 'COMPLETE'
      | 'PARTIAL_FAILURE'
      | 'FAILED';
    scheduledFor?: string;
    lastUpdatedAt?: string;
    totals?: {
      target: number;
      succeeded: number;
      skipped: number;
      failed: number;
    };
  }>;
  providerHealth: Array<{
    provider: string;
    operation: string;
    status: 'healthy' | 'degraded' | 'outage';
    lastAttemptAt: string;
    lastSuccessAt?: string;
    consecutiveFailedRuns: number;
    lastResultKind: string;
    lastErrorCode?: string;
    alertState: 'closed' | 'open';
  }>;
  incidents: Array<{
    incidentId: string;
    occurrenceId: string;
    reason: string;
    openedAt: string;
  }>;
  functionLatency: {
    status: 'available' | 'unavailable';
    windowHours: number;
    operations: Array<{
      endpoint:
        | 'executeHouseholdCommand'
        | 'executeHouseholdQuery'
        | 'submitAndroidRawNotification'
        | 'addExpenseFromMessage'
        | 'consumeNotificationOutbox'
        | 'clientStartup';
      operation: string;
      sampleCount: number;
      succeededCount: number;
      failedCount: number;
      averageMs: number;
      p95Ms: number;
      maxMs: number;
      latestAt: string;
    }>;
  };
}
