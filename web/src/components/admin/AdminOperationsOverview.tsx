'use client';

import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Home,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
  WalletCards,
} from 'lucide-react';

import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

interface AdminOperationsOverviewProps {
  dashboard: AdminOperationsDashboardWireView;
  refreshing: boolean;
  onRefresh(): void;
}

const JOB_LABELS: Record<string, string> = {
  'recurring-daily': '고정비 등록',
  'asset-automation-daily': '자산 자동 처리',
  'instrument-catalog-daily': '종목 목록',
  'dividend-hourly': '배당 공시',
  'asset-valuation-daily': '자산 스냅샷',
  'billing-cost-refresh': 'Google Cloud 비용 집계',
  'scheduled-job-monitor': '스케줄 감시',
};

const FUNCTION_ENDPOINT_LABELS: Record<string, string> = {
  executeHouseholdCommand: '가계부 명령',
  executeHouseholdQuery: '가계부 조회',
  submitAndroidRawNotification: 'Android 결제 수집',
  addExpenseFromMessage: 'iPhone 결제 수집',
  consumeNotificationOutbox: 'FCM 알림 발송',
  clientStartup: '클라이언트 앱',
};

const FUNCTION_OPERATION_LABELS: Record<string, string> = {
  'client.android-app-first-home-complete-paint.v1':
    'Android 앱 실행 → 첫 화면 전체 표시',
  'client.ios-pwa-first-home-complete-paint.v1':
    'iPhone 앱 실행 → 첫 화면 전체 표시',
  'access.resolve-signed-in-user.v1': '로그인 사용자 확인',
  'access.record-app-visit.v1': '앱 접속 기록',
  'access.claim-legacy-membership.v1': '기존 가계부 연결',
  'access.create-household-with-self.v1': '새 가계부 생성',
  'access.join-household-as-self.v1': '초대 코드로 가계부 참여',
  'access.create-invitation.v1': '가구원 초대 코드 생성',
  'access.rename-self.v1': '가구원 이름 변경',
  'access.request-household-deletion.v1': '가계부 삭제 요청',
  'access.create-asset-owner-profile.v1': '자산 명의자 추가',
  'access.rename-asset-owner-profile.v1': '자산 명의자 이름 변경',
  'access.archive-asset-owner-profile.v1': '자산 명의자 삭제',
  'ledger.get-transaction.v1': '지출·수입 상세 조회',
  'ledger.record-manual-transaction.v1': '지출·수입 수동 등록',
  'ledger.record-manual-monthly-split.v1': '월 분할 지출 등록',
  'ledger.split-existing-transaction-monthly.v1': '지출 월 분할',
  'ledger.update-transaction.v1': '지출·수입 수정',
  'ledger.delete-transaction.v1': '지출·수입 삭제',
  'ledger.change-transaction-category.v1': '지출 카테고리 변경',
  'ledger.split-transaction.v1': '지출 나누기',
  'ledger.merge-transactions.v1': '지출 합치기',
  'ledger.unmerge-transaction.v1': '지출 합치기 취소',
  'ledger.cancel-monthly-split.v1': '월 분할 취소',
  'ledger.reconfigure-monthly-split.v1': '월 분할 재설정',
  'category.create.v1': '카테고리 추가',
  'category.update.v1': '카테고리 수정',
  'category.archive.v1': '카테고리 삭제',
  'category.set-budget.v1': '카테고리 예산 설정',
  'category.reorder.v1': '카테고리 순서 변경',
  'category.set-default.v1': '기본 카테고리 설정',
  'home.update-summary-preferences.v1': '첫 화면 요약 카드 변경',
  'home.select-local-currency.v1': '표시할 지역화폐 선택',
  'portfolio.create-asset.v1': '자산 추가',
  'portfolio.update-asset.v1': '자산 수정',
  'portfolio.reorder-assets.v1': '자산 순서 변경',
  'portfolio.delete-asset.v1': '자산 삭제',
  'portfolio.add-position.v1': '주식·코인 종목 추가',
  'portfolio.update-position.v1': '주식·코인 종목 수정',
  'portfolio.delete-position.v1': '주식·코인 종목 삭제',
  'portfolio.refresh-market-values.v1': '보유 자산 시세 갱신',
  'portfolio.search-instruments.v1': '주식·코인 종목 검색',
  'portfolio.get-instrument-quote.v1': '종목 시세 조회',
  'portfolio.get-dividend-projection.v1': '예상 배당 조회',
  'payment-configuration.create-merchant-rule.v1': '가맹점 분류 규칙 추가',
  'payment-configuration.update-merchant-rule.v1': '가맹점 분류 규칙 수정',
  'payment-configuration.delete-merchant-rule.v1': '가맹점 분류 규칙 삭제',
  'payment-configuration.register-card.v1': '카드 등록',
  'payment-configuration.update-card.v1': '카드 수정',
  'payment-configuration.delete-card.v1': '카드 삭제',
  'payment-configuration.reorder-cards.v1': '카드 순서 변경',
  'shortcut.issue-credential.v1': 'iPhone 자동 등록 키 발급',
  'shortcut.reissue-credential.v1': 'iPhone 자동 등록 키 재발급',
  'shortcut.revoke-credential.v1': 'iPhone 자동 등록 키 폐기',
  'shortcut.get-credential-status.v1': 'iPhone 자동 등록 키 확인',
  'recurring.create-plan.v1': '고정비 추가',
  'recurring.update-plan.v1': '고정비 수정',
  'recurring.delete-plan.v1': '고정비 삭제',
  'notifications.register-endpoint.v1': '알림 기기 등록',
  'notifications.remove-endpoint.v1': '알림 기기 연결 해제',
  'notifications.deliver-household-request.v1': '가구원 알림 FCM 접수',
  'notifications.deliver-ios-shortcut.v1': 'iPhone 수정 알림 FCM 접수',
  'payment-capture.submit-android-raw-notification.v1': 'Android 결제 알림 처리',
  'payment-capture.submit-ios-shortcut-message.v1': 'iPhone 결제 알림 처리',
};

const FUNCTION_OPERATION_GROUPS = [
  {
    label: '앱 시작',
    operations: [
      'client.android-app-first-home-complete-paint.v1',
      'client.ios-pwa-first-home-complete-paint.v1',
    ],
  },
  {
    label: '접속·가계부',
    operations: [
      'access.resolve-signed-in-user.v1',
      'access.record-app-visit.v1',
      'access.claim-legacy-membership.v1',
      'access.create-household-with-self.v1',
      'access.join-household-as-self.v1',
      'access.create-invitation.v1',
      'access.rename-self.v1',
      'access.request-household-deletion.v1',
    ],
  },
  {
    label: '자산 명의자',
    operations: [
      'access.create-asset-owner-profile.v1',
      'access.rename-asset-owner-profile.v1',
      'access.archive-asset-owner-profile.v1',
    ],
  },
  {
    label: '지출·수입',
    operations: [
      'ledger.get-transaction.v1',
      'ledger.record-manual-transaction.v1',
      'ledger.update-transaction.v1',
      'ledger.change-transaction-category.v1',
      'ledger.delete-transaction.v1',
    ],
  },
  {
    label: '지출 나누기',
    operations: [
      'ledger.split-transaction.v1',
    ],
  },
  {
    label: '지출 합치기',
    operations: [
      'ledger.merge-transactions.v1',
      'ledger.unmerge-transaction.v1',
    ],
  },
  {
    label: '월 분할',
    operations: [
      'ledger.record-manual-monthly-split.v1',
      'ledger.split-existing-transaction-monthly.v1',
      'ledger.reconfigure-monthly-split.v1',
      'ledger.cancel-monthly-split.v1',
    ],
  },
  {
    label: '카테고리',
    operations: [
      'category.create.v1',
      'category.update.v1',
      'category.archive.v1',
      'category.set-budget.v1',
      'category.reorder.v1',
      'category.set-default.v1',
    ],
  },
  {
    label: '첫 화면',
    operations: [
      'home.update-summary-preferences.v1',
      'home.select-local-currency.v1',
    ],
  },
  {
    label: '자산',
    operations: [
      'portfolio.create-asset.v1',
      'portfolio.update-asset.v1',
      'portfolio.delete-asset.v1',
      'portfolio.reorder-assets.v1',
    ],
  },
  {
    label: '보유 종목',
    operations: [
      'portfolio.add-position.v1',
      'portfolio.update-position.v1',
      'portfolio.delete-position.v1',
      'portfolio.refresh-market-values.v1',
    ],
  },
  {
    label: '종목 조회',
    operations: [
      'portfolio.search-instruments.v1',
      'portfolio.get-instrument-quote.v1',
      'portfolio.get-dividend-projection.v1',
    ],
  },
  {
    label: '가맹점 규칙',
    operations: [
      'payment-configuration.create-merchant-rule.v1',
      'payment-configuration.update-merchant-rule.v1',
      'payment-configuration.delete-merchant-rule.v1',
    ],
  },
  {
    label: '카드',
    operations: [
      'payment-configuration.register-card.v1',
      'payment-configuration.update-card.v1',
      'payment-configuration.delete-card.v1',
      'payment-configuration.reorder-cards.v1',
    ],
  },
  {
    label: 'iPhone 자동 등록',
    operations: [
      'shortcut.get-credential-status.v1',
      'shortcut.issue-credential.v1',
      'shortcut.reissue-credential.v1',
      'shortcut.revoke-credential.v1',
    ],
  },
  {
    label: '고정비',
    operations: [
      'recurring.create-plan.v1',
      'recurring.update-plan.v1',
      'recurring.delete-plan.v1',
    ],
  },
  {
    label: '알림 기기',
    operations: [
      'notifications.register-endpoint.v1',
      'notifications.remove-endpoint.v1',
    ],
  },
  {
    label: '알림 발송',
    operations: [
      'notifications.deliver-household-request.v1',
      'notifications.deliver-ios-shortcut.v1',
    ],
  },
  {
    label: '결제 알림 수집',
    operations: [
      'payment-capture.submit-android-raw-notification.v1',
      'payment-capture.submit-ios-shortcut-message.v1',
    ],
  },
] as const;

const FUNCTION_OPERATION_ORDER: ReadonlyMap<
  string,
  { groupLabel: string; groupIndex: number; operationIndex: number }
> = new Map(
  FUNCTION_OPERATION_GROUPS.flatMap((group, groupIndex) =>
    group.operations.map((operation, operationIndex) => [
      operation,
      { groupLabel: group.label, groupIndex, operationIndex },
    ] as const)
  )
);

function functionOperationMetadata(operation: string) {
  return FUNCTION_OPERATION_ORDER.get(operation) ?? {
    groupLabel: '기타',
    groupIndex: FUNCTION_OPERATION_GROUPS.length,
    operationIndex: Number.MAX_SAFE_INTEGER,
  };
}

function compareFunctionOperations(
  left: AdminOperationsDashboardWireView['functionLatency']['operations'][number],
  right: AdminOperationsDashboardWireView['functionLatency']['operations'][number]
): number {
  const leftMetadata = functionOperationMetadata(left.operation);
  const rightMetadata = functionOperationMetadata(right.operation);
  return leftMetadata.groupIndex - rightMetadata.groupIndex
    || leftMetadata.operationIndex - rightMetadata.operationIndex
    || left.operation.localeCompare(right.operation);
}

const JOB_STATUS_LABELS: Record<string, string> = {
  UNKNOWN: '기록 없음',
  EXPECTED: '실행 대기',
  RUNNING: '실행 중',
  MISSING: '미실행',
  OVERDUE: '시간 초과',
  COMPLETE: '정상',
  PARTIAL_FAILURE: '일부 실패',
  FAILED: '실패',
};

function formatDateTime(value?: string): string {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatDuration(value: number): string {
  return `${(value / 1_000).toLocaleString('ko-KR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })}초`;
}

function formatCurrency(value: number, currency: string): string {
  if (currency === 'KRW') {
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
  }
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('ko-KR')} ${currency}`;
  }
}

function shortDate(value: string): string {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

function healthCopy(health: AdminOperationsDashboardWireView['service']['health']) {
  if (health === 'healthy') {
    return {
      label: '모든 시스템 정상',
      detail: '예약 작업과 외부 공급자가 정상 범위입니다.',
      classes: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
      dot: 'bg-emerald-400',
    };
  }
  if (health === 'critical') {
    return {
      label: '확인이 필요한 장애',
      detail: '열린 장애 또는 공급자 중단이 있습니다.',
      classes: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
      dot: 'bg-rose-400',
    };
  }
  return {
    label: '일부 상태 확인 필요',
    detail: '실패·지연·기록 없음 항목이 있습니다.',
    classes: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    dot: 'bg-amber-400',
  };
}

function statusClasses(status: string): string {
  if (status === 'COMPLETE' || status === 'healthy' || status === 'closed') {
    return 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20';
  }
  if (status === 'EXPECTED' || status === 'RUNNING') {
    return 'bg-sky-400/10 text-sky-300 ring-sky-400/20';
  }
  if (status === 'UNKNOWN' || status === 'degraded') {
    return 'bg-amber-400/10 text-amber-300 ring-amber-400/20';
  }
  return 'bg-rose-400/10 text-rose-300 ring-rose-400/20';
}

export function AdminOperationsOverview({
  dashboard,
  refreshing,
  onRefresh,
}: AdminOperationsOverviewProps) {
  const health = healthCopy(dashboard.service.health);
  const maxDailyAccess = Math.max(
    1,
    ...dashboard.dailyAccess.map(({ count }) => count)
  );
  const functionLatency = dashboard.functionLatency ?? {
    status: 'unavailable' as const,
    windowHours: 24,
    operations: [],
  };
  const billingCost = dashboard.billingCost ?? {
    status: 'unavailable' as const,
  };
  const sortedFunctionOperations = [...functionLatency.operations]
    .sort(compareFunctionOperations);
  const activeUsers = dashboard.households
    .flatMap((household) =>
      household.members
        .filter(
          (member) =>
            household.lifecycleState === 'active'
            && member.lifecycleState === 'active'
            && member.linkedPrincipal
        )
        .map((member) => ({
          ...member,
          householdId: household.householdId,
          householdName: household.name,
        }))
    )
    .sort(
      (left, right) =>
        right.todayAccessCount - left.todayAccessCount
        || right.totalAccessCount - left.totalAccessCount
        || (right.lastAccessAt ?? '').localeCompare(left.lastAccessAt ?? '')
        || left.householdName.localeCompare(right.householdName, 'ko')
        || left.displayName.localeCompare(right.displayName, 'ko')
    );

  return (
    <>
      <section className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className={`rounded-xl border p-5 ${health.classes}`}>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
                Server health
              </p>
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${health.dot} shadow-[0_0_14px_currentColor]`} />
                <h2 className="text-xl font-semibold">{health.label}</h2>
              </div>
              <p className="mt-2 text-sm opacity-75">{health.detail}</p>
            </div>
            <Server className="h-6 w-6 opacity-60" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Meta label="리비전" value={dashboard.service.revision} mono />
            <Meta label="리전" value={dashboard.service.region} mono />
            <Meta
              label="관리 API"
              value="온라인"
            />
            <Meta label="확인 시각" value={formatDateTime(dashboard.generatedAt)} />
          </div>
        </div>

        <MetricCard
          icon={<Home className="h-5 w-5" />}
          label="활성 가구"
          value={dashboard.summary.activeHouseholds}
          detail={`삭제 상태 ${dashboard.summary.deletedHouseholds}가구`}
          tone="sky"
        />
        <MetricCard
          icon={<Users className="h-5 w-5" />}
          label="활성 사용자"
          value={dashboard.summary.activeMembers}
          detail={`오늘 ${dashboard.summary.todayAccessCount.toLocaleString('ko-KR')}회 접속`}
          tone="violet"
        />
      </section>

      <Panel
        title="Google Cloud 비용"
        description="현재까지 집계된 사용액과 최근 7일 추세를 반영한 월말 예상"
      >
        {billingCost.status === 'unavailable' ? (
          <EmptyState>비용 집계를 준비하고 있습니다.</EmptyState>
        ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr_1.4fr]">
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    이번 달 누적 비용(잠정)
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-sky-300">
                    {formatCurrency(
                      billingCost.monthToDateAmount,
                      billingCost.currency
                    )}
                  </p>
                </div>
                <WalletCards className="h-5 w-5 text-sky-400" />
              </div>
              <p className="mt-4 text-xs text-slate-600">
                {billingCost.billingMonth.replace('-', '년 ')}월 사용액
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    월말 예상 비용
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-violet-300">
                    {formatCurrency(
                      billingCost.estimatedMonthEndAmount,
                      billingCost.currency
                    )}
                  </p>
                </div>
                <TrendingUp className="h-5 w-5 text-violet-400" />
              </div>
              <p className="mt-4 text-xs text-slate-600">
                마지막 비용 집계 {formatDateTime(billingCost.calculatedAt)}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs font-medium text-slate-500">서비스별 비용</p>
              {billingCost.serviceAmounts.length === 0 ? (
                <p className="mt-6 text-center text-xs text-slate-600">
                  집계된 서비스 비용이 없습니다.
                </p>
              ) : (
                <div className="mt-3 max-h-36 space-y-2 overflow-y-auto pr-1">
                  {billingCost.serviceAmounts.map((service) => (
                    <div
                      key={service.serviceId}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="truncate text-slate-400" title={service.serviceName}>
                        {service.serviceName}
                      </span>
                      <span className="shrink-0 font-mono text-slate-200">
                        {formatCurrency(service.amount, billingCost.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="사용자 체감·서버 처리 시간"
        description={`최근 ${functionLatency.windowHours}시간 앱 첫 화면과 서버 로직별 total 구조화 로그 집계`}
      >
        {functionLatency.status === 'unavailable' ? (
          <EmptyState>
            Cloud Logging 처리 시간을 읽지 못했습니다.
          </EmptyState>
        ) : functionLatency.operations.length === 0 ? (
          <EmptyState>
            해당 기간에 수집된 처리 시간 기록이 없습니다.
          </EmptyState>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[940px] text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">업무군</th>
                  <th className="px-4 py-3 font-medium">처리 업무</th>
                  <th className="px-4 py-3 font-medium">측정 경로</th>
                  <th className="px-4 py-3 text-right font-medium">호출</th>
                  <th className="px-4 py-3 text-right font-medium">성공</th>
                  <th className="px-4 py-3 text-right font-medium">평균</th>
                  <th className="px-4 py-3 text-right font-medium">P95</th>
                  <th className="px-4 py-3 text-right font-medium">최대</th>
                  <th className="px-4 py-3 text-right font-medium">최근 호출</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {sortedFunctionOperations.map((operation, index) => {
                  const metadata = functionOperationMetadata(operation.operation);
                  const previousMetadata = index === 0
                    ? undefined
                    : functionOperationMetadata(sortedFunctionOperations[index - 1].operation);
                  return (
                    <tr
                      key={`${operation.endpoint}:${operation.operation}`}
                      className={`text-slate-300 ${
                        previousMetadata && previousMetadata.groupLabel !== metadata.groupLabel
                          ? 'border-t-2 border-slate-700'
                          : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-sky-400">
                        {metadata.groupLabel}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-100">
                          {FUNCTION_OPERATION_LABELS[operation.operation] ?? '기타 내부 처리'}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-600">
                          {operation.operation}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {FUNCTION_ENDPOINT_LABELS[operation.endpoint] ?? operation.endpoint}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {operation.sampleCount.toLocaleString('ko-KR')}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${operation.failedCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {operation.succeededCount}/{operation.sampleCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sky-300">
                        {formatDuration(operation.averageMs)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-violet-300">
                        {formatDuration(operation.p95Ms)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">
                        {formatDuration(operation.maxMs)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {formatDateTime(operation.latestAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="사용자별 접속"
        description="현재 가구에 연결된 활성 로그인 사용자별 앱 실행 완료 횟수"
      >
        {activeUsers.length === 0 ? (
          <EmptyState>접속 통계를 집계할 활성 사용자가 없습니다.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">사용자</th>
                  <th className="px-4 py-3 font-medium">가계부</th>
                  <th className="px-4 py-3 text-right font-medium">오늘 접속</th>
                  <th className="px-4 py-3 text-right font-medium">누적 접속</th>
                  <th className="px-4 py-3 text-right font-medium">최근 접속</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {activeUsers.map((user) => (
                  <tr
                    key={`${user.householdId}:${user.memberId}`}
                    className="text-slate-300"
                  >
                    <td className="px-4 py-3 font-medium text-slate-100">
                      {user.displayName}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {user.householdName}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-sky-300">
                      {user.todayAccessCount.toLocaleString('ko-KR')}회
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {user.totalAccessCount.toLocaleString('ko-KR')}회
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {formatDateTime(user.lastAccessAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section className="grid gap-3 lg:grid-cols-[1.7fr_1fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-black/10">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-100">앱 접속 추이</p>
              <p className="mt-1 text-xs text-slate-500">
                최근 14일 · 집계 기능 적용 이후의 앱 실행 완료 횟수
              </p>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Activity className="h-4 w-4" />
              <span className="font-mono text-xl font-semibold text-slate-100">
                {dashboard.summary.totalAccessCount.toLocaleString('ko-KR')}
              </span>
              <span className="text-xs">누적</span>
            </div>
          </div>
          <div className="flex h-48 items-end gap-1.5 border-b border-slate-800 px-1">
            {dashboard.dailyAccess.map((daily) => {
              const height = daily.count === 0
                ? 2
                : Math.max(7, Math.round((daily.count / maxDailyAccess) * 100));
              return (
                <div
                  key={daily.date}
                  className="group relative flex h-full min-w-0 flex-1 items-end"
                >
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-sky-600 to-cyan-300 transition-colors group-hover:from-sky-500 group-hover:to-cyan-200"
                    style={{ height: `${height}%` }}
                  />
                  <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 shadow-xl group-hover:block">
                    {daily.date} · {daily.count}회
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1.5 px-1 text-[10px] text-slate-600">
            {dashboard.dailyAccess.map((daily, index) => (
              <span key={daily.date} className="min-w-0 flex-1 text-center">
                {index % 2 === 0 || index === dashboard.dailyAccess.length - 1
                  ? shortDate(daily.date)
                  : ''}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <MetricCard
            icon={<Clock3 className="h-5 w-5" />}
            label="열린 스케줄 장애"
            value={dashboard.summary.openIncidents}
            detail={
              dashboard.summary.openIncidents === 0
                ? '누락·시간 초과 없음'
                : '아래 장애 내역 확인 필요'
            }
            tone={dashboard.summary.openIncidents === 0 ? 'emerald' : 'rose'}
            compact
          />
          <MetricCard
            icon={<Database className="h-5 w-5" />}
            label="비정상 공급자"
            value={dashboard.summary.unhealthyProviders}
            detail={
              dashboard.summary.unhealthyProviders === 0
                ? '등록된 공급자 정상'
                : '시세 공급 상태 확인 필요'
            }
            tone={dashboard.summary.unhealthyProviders === 0 ? 'emerald' : 'amber'}
            compact
          />
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <Panel
          title="예약 작업"
          description="Cloud Scheduler가 실행한 작업별 최신 상태"
          action={
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-slate-600 hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">작업</th>
                  <th className="px-4 py-3 font-medium">상태</th>
                  <th className="px-4 py-3 font-medium">최근 예정 시각</th>
                  <th className="px-4 py-3 text-right font-medium">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {dashboard.scheduledJobs.map((job) => (
                  <tr key={job.jobName} className="text-slate-300">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-200">
                        {JOB_LABELS[job.jobName] ?? job.jobName}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-600">
                        {job.cron}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.latestStatus}>
                        {JOB_STATUS_LABELS[job.latestStatus] ?? job.latestStatus}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {formatDateTime(job.scheduledFor)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {job.totals
                        ? `${job.totals.succeeded + job.totals.skipped}/${job.totals.target}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="외부 공급자"
          description="주식·금·배당 등 외부 데이터 공급 상태"
        >
          {dashboard.providerHealth.length === 0 ? (
            <EmptyState>아직 저장된 공급자 상태가 없습니다.</EmptyState>
          ) : (
            <div className="max-h-[385px] divide-y divide-slate-800/80 overflow-y-auto">
              {dashboard.providerHealth.map((provider) => (
                <div
                  key={`${provider.provider}:${provider.operation}`}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {provider.provider}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-slate-600">
                      {provider.operation}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusBadge status={provider.status}>
                      {provider.status === 'healthy'
                        ? '정상'
                        : provider.status === 'degraded'
                          ? '저하'
                          : '중단'}
                    </StatusBadge>
                    <p className="mt-1.5 text-[10px] text-slate-600">
                      {formatDateTime(provider.lastAttemptAt)}
                      {provider.consecutiveFailedRuns > 0
                        ? ` · ${provider.consecutiveFailedRuns}회 실패`
                        : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      {dashboard.incidents.length > 0 && (
        <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            <h2 className="text-sm font-semibold">열린 장애</h2>
          </div>
          <div className="space-y-2">
            {dashboard.incidents.map((incident) => (
              <div
                key={incident.incidentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/20 bg-slate-950/40 px-3 py-2 text-xs"
              >
                <span className="font-mono text-rose-200">
                  {incident.occurrenceId}
                </span>
                <span className="text-slate-400">
                  {incident.reason} · {formatDateTime(incident.openedAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-950/20 px-3 py-2">
      <p className="mb-1 opacity-60">{label}</p>
      <p className={`truncate font-medium ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
  tone: 'sky' | 'violet' | 'emerald' | 'amber' | 'rose';
  compact?: boolean;
}) {
  const tones = {
    sky: 'text-sky-300 bg-sky-400/10',
    violet: 'text-violet-300 bg-violet-400/10',
    emerald: 'text-emerald-300 bg-emerald-400/10',
    amber: 'text-amber-300 bg-amber-400/10',
    rose: 'text-rose-300 bg-rose-400/10',
  };
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/80 ${compact ? 'p-4' : 'p-5'} shadow-xl shadow-black/10`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
            {label}
          </p>
          <p className={`${compact ? 'mt-2 text-3xl' : 'mt-5 text-4xl'} font-semibold tracking-tight text-slate-100`}>
            {value.toLocaleString('ko-KR')}
          </p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-lg p-2.5 ${tones[tone]}`}>{icon}</div>
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 shadow-xl shadow-black/10">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-600">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusBadge({
  status,
  children,
}: {
  status: string;
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ring-inset ${statusClasses(status)}`}>
      {status === 'COMPLETE' || status === 'healthy' || status === 'closed'
        ? <CheckCircle2 className="h-3 w-3" />
        : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center text-xs text-slate-600">
      {children}
    </div>
  );
}
