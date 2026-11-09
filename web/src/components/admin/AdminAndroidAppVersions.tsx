import type { AdminDashboardMemberActivity } from '@/platform/functions-api';

const confirmedAtFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export function AdminAndroidAppVersions({ versions }: {
  versions: AdminDashboardMemberActivity['androidAppVersions'];
}) {
  const latest = versions?.[0];
  if (!latest) return <span className="text-slate-500">확인 안 됨</span>;
  const { version, lastConfirmedAt } = latest;
  return (
    <div>
      <span className="break-words font-mono text-slate-300">
        {version ? `v${version}` : '버전 확인 안 됨'}
      </span>
      <div className="text-[10px] text-slate-500">
        {lastConfirmedAt
          ? <time dateTime={lastConfirmedAt}>{confirmedAtFormat.format(new Date(lastConfirmedAt))} 확인</time>
          : '확인 시각 없음'}
      </div>
    </div>
  );
}
