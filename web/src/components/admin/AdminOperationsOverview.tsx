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
  Users,
} from 'lucide-react';

import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

interface AdminOperationsOverviewProps {
  dashboard: AdminOperationsDashboardWireView;
  requestLatencyMs: number | null;
  refreshing: boolean;
  onRefresh(): void;
}

const JOB_LABELS: Record<string, string> = {
  'recurring-daily': '정기 거래',
  'asset-automation-daily': '자산 자동 처리',
  'instrument-catalog-daily': '종목 목록',
  'dividend-hourly': '배당 공시',
  'asset-valuation-daily': '자산 스냅샷',
  'scheduled-job-monitor': '스케줄 감시',
};

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
  requestLatencyMs,
  refreshing,
  onRefresh,
}: AdminOperationsOverviewProps) {
  const health = healthCopy(dashboard.service.health);
  const maxDailyAccess = Math.max(
    1,
    ...dashboard.dailyAccess.map(({ count }) => count)
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
              value={requestLatencyMs === null ? '온라인' : `온라인 · ${requestLatencyMs}ms`}
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
