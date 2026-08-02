import { render, screen } from '@testing-library/react';

import { AdminOperationsOverview } from '@/components/admin/AdminOperationsOverview';
import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

function dashboard(
  billingCost: AdminOperationsDashboardWireView['billingCost']
): AdminOperationsDashboardWireView {
  return {
    generatedAt: '2026-08-02T06:00:00.000Z',
    service: {
      apiStatus: 'online',
      health: 'healthy',
      serviceName: 'executeAdminAccess',
      revision: 'revision-1',
      region: 'asia-northeast3',
    },
    summary: {
      activeHouseholds: 3,
      deletedHouseholds: 0,
      activeMembers: 6,
      todayAccessCount: 4,
      totalAccessCount: 30,
      unhealthyProviders: 0,
      openIncidents: 0,
    },
    dailyAccess: [],
    households: [],
    scheduledJobs: [],
    providerHealth: [],
    incidents: [],
    functionLatency: {
      status: 'unavailable',
      windowHours: 24,
      operations: [],
    },
    billingCost,
  };
}

describe('admin Google Cloud billing cost contract', () => {
  test('[T-ADM-005] renders accrued, estimated, service, and aggregation values', () => {
    render(
      <AdminOperationsOverview
        dashboard={dashboard({
          status: 'available',
          billingMonth: '2026-08',
          currency: 'KRW',
          monthToDateAmount: 869,
          estimatedMonthEndAmount: 1_400,
          calculatedAt: '2026-08-02T06:00:00.000Z',
          dataUpdatedAt: '2026-08-02T05:40:00.000Z',
          serviceAmounts: [
            { serviceId: 'functions', serviceName: 'Cloud Functions', amount: 500 },
            { serviceId: 'firestore', serviceName: 'Firestore', amount: 250 },
          ],
        })}
        refreshing={false}
        onRefresh={jest.fn()}
      />
    );

    expect(screen.getByText('Google Cloud 비용')).toBeInTheDocument();
    expect(screen.getByText('이번 달 누적 비용(잠정)')).toBeInTheDocument();
    expect(screen.getByText('869원')).toBeInTheDocument();
    expect(screen.getByText('월말 예상 비용')).toBeInTheDocument();
    expect(screen.getByText('1,400원')).toBeInTheDocument();
    expect(screen.getByText('Cloud Functions')).toBeInTheDocument();
    expect(screen.getByText('Firestore')).toBeInTheDocument();
    expect(screen.getByText(/마지막 비용 집계/)).toBeInTheDocument();
    expect(screen.queryByText(/최종 청구액/)).not.toBeInTheDocument();
  });

  test('[T-ADM-005] keeps the dashboard usable before the first export snapshot', () => {
    render(
      <AdminOperationsOverview
        dashboard={dashboard({ status: 'unavailable' })}
        refreshing={false}
        onRefresh={jest.fn()}
      />
    );

    expect(screen.getByText('비용 집계를 준비하고 있습니다.')).toBeInTheDocument();
  });

  test('[T-ADM-005] stays usable while an older Functions revision omits billingCost', () => {
    const { billingCost: _billingCost, ...legacyDashboard } = dashboard({
      status: 'unavailable',
    });

    render(
      <AdminOperationsOverview
        dashboard={legacyDashboard as AdminOperationsDashboardWireView}
        refreshing={false}
        onRefresh={jest.fn()}
      />
    );

    expect(screen.getByText('비용 집계를 준비하고 있습니다.')).toBeInTheDocument();
  });
});
