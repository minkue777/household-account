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
            operation: 'ledger.unmerge-transaction.v1',
            sampleCount: 2,
            succeededCount: 2,
            failedCount: 0,
            averageMs: 800,
            p95Ms: 900,
            maxMs: 1_000,
            latestAt: '2026-07-28T00:09:00.000Z',
          },
          {
            endpoint: 'executeHouseholdCommand',
            operation: 'ledger.delete-transaction.v1',
            sampleCount: 2,
            succeededCount: 2,
            failedCount: 0,
            averageMs: 500,
            p95Ms: 600,
            maxMs: 700,
            latestAt: '2026-07-28T00:09:00.000Z',
          },
          {
            endpoint: 'executeHouseholdCommand',
            operation: 'ledger.merge-transactions.v1',
            sampleCount: 2,
            succeededCount: 2,
            failedCount: 0,
            averageMs: 700,
            p95Ms: 800,
            maxMs: 900,
            latestAt: '2026-07-28T00:09:00.000Z',
          },
          {
            endpoint: 'executeHouseholdCommand',
            operation: 'ledger.split-transaction.v1',
            sampleCount: 2,
            succeededCount: 2,
            failedCount: 0,
            averageMs: 600,
            p95Ms: 700,
            maxMs: 800,
            latestAt: '2026-07-28T00:09:00.000Z',
          },
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

    const updateRow = screen.getByText('ledger.update-transaction.v1').closest('tr');
    const deleteRow = screen.getByText('ledger.delete-transaction.v1').closest('tr');
    const splitRow = screen.getByText('ledger.split-transaction.v1').closest('tr');
    const mergeRow = screen.getByText('ledger.merge-transactions.v1').closest('tr');
    const unmergeRow = screen.getByText('ledger.unmerge-transaction.v1').closest('tr');

    expect(
      updateRow!.compareDocumentPosition(deleteRow!)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      deleteRow!.compareDocumentPosition(splitRow!)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      splitRow!.compareDocumentPosition(mergeRow!)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      mergeRow!.compareDocumentPosition(unmergeRow!)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
