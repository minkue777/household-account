import { render, screen } from '@testing-library/react';

import { AdminOperationsOverview } from '@/components/admin/AdminOperationsOverview';
import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

describe('admin Cloud Function latency contract', () => {
  test('[T-ADM-004] renders server-side operation latency instead of browser round-trip time', () => {
    const dashboard: AdminOperationsDashboardWireView = {
      generatedAt: '2026-07-28T00:10:00.000Z',
      service: {
        apiStatus: 'online',
        health: 'healthy',
        serviceName: 'executeAdminAccess',
        revision: 'revision-1',
        region: 'asia-northeast3',
      },
      summary: {
        activeHouseholds: 2,
        deletedHouseholds: 0,
        activeMembers: 4,
        todayAccessCount: 3,
        totalAccessCount: 10,
        unhealthyProviders: 0,
        openIncidents: 0,
      },
      dailyAccess: [],
      households: [],
      scheduledJobs: [],
      providerHealth: [],
      incidents: [],
      functionLatency: {
        status: 'available',
        windowHours: 24,
        operations: [
          {
            endpoint: 'executeHouseholdCommand',
            operation: 'ledger.update-transaction.v1',
            sampleCount: 5,
            succeededCount: 4,
            failedCount: 1,
            averageMs: 120.4,
            p95Ms: 310,
            maxMs: 420,
            latestAt: '2026-07-28T00:09:00.000Z',
          },
        ],
      },
    };

    render(
      <AdminOperationsOverview
        dashboard={dashboard}
        refreshing={false}
        onRefresh={jest.fn()}
      />
    );

    expect(
      screen.getByText(`Cloud Functions ${'\uCC98\uB9AC \uC2DC\uAC04'}`)
    ).toBeInTheDocument();
    expect(screen.getByText('지출·수입 수정')).toBeInTheDocument();
    expect(screen.getByText('ledger.update-transaction.v1')).toBeInTheDocument();
    expect(screen.getByText('0.120초')).toBeInTheDocument();
    expect(screen.getByText('0.310초')).toBeInTheDocument();
    expect(screen.getByText('0.420초')).toBeInTheDocument();
    expect(screen.queryByText(/online.*ms/i)).not.toBeInTheDocument();
  });
});
