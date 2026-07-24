'use client';

import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';

import type {
  AdminDashboardHouseholdActivity,
  AdminDeletedAssetWireView,
  AdminHouseholdWireView,
  AdminMemberWireView,
  AssetOwnerProfileWireView,
} from '@/platform/functions-api';

import { AdminHouseholdOperations } from './AdminHouseholdOperations';

interface AdminHouseholdListProps {
  households: AdminDashboardHouseholdActivity[];
  isLoading: boolean;
  copiedKey: string | null;
  detailHouseholdId: string | null;
  detailsLoading: boolean;
  members: AdminMemberWireView[];
  profiles: AssetOwnerProfileWireView[];
  deletedAssets: AdminDeletedAssetWireView[];
  onCopy(householdId: string): Promise<void>;
  onOpenHousehold(household: AdminHouseholdWireView): void;
  onLoadDetails(householdId: string): Promise<void>;
  onCloseDetails(): void;
  onDelete(household: AdminHouseholdWireView): void;
  onRestoreHousehold(household: AdminHouseholdWireView): Promise<void>;
  onRemoveMember(member: AdminMemberWireView): Promise<void>;
  onRestoreMember(member: AdminMemberWireView): Promise<void>;
  onArchiveProfile(profile: AssetOwnerProfileWireView): Promise<void>;
  onRestoreAsset(asset: AdminDeletedAssetWireView): Promise<void>;
}

function formatDateTime(value?: string): string {
  if (!value) return '아직 접속 기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function AdminHouseholdList({
  households,
  isLoading,
  copiedKey,
  detailHouseholdId,
  detailsLoading,
  members,
  profiles,
  deletedAssets,
  onCopy,
  onOpenHousehold,
  onLoadDetails,
  onCloseDetails,
  onDelete,
  onRestoreHousehold,
  onRemoveMember,
  onRestoreMember,
  onArchiveProfile,
  onRestoreAsset,
}: AdminHouseholdListProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 shadow-xl shadow-black/10">
      <div className="border-b border-slate-800 px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">가계 정보</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              가구·사용자별 접속 현황과 관리자 작업
            </p>
          </div>
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400">
            {households.length}가구
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-slate-600">
          가계 정보를 불러오는 중입니다.
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {households.map((household) => {
            const detailOpen = detailHouseholdId === household.householdId;
            return (
              <article key={household.householdId} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-slate-100">
                        {household.name}
                      </h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                        household.lifecycleState === 'active'
                          ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'
                          : 'bg-rose-400/10 text-rose-300 ring-rose-400/20'
                      }`}>
                        {household.lifecycleState === 'active' ? '활성' : '삭제됨'}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-700">
                      {household.householdId}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                      onClick={() => onOpenHousehold(household)}
                    >
                      가계부 열기
                    </ActionButton>
                    <ActionButton
                      icon={<Clipboard className="h-3.5 w-3.5" />}
                      onClick={() => void onCopy(household.householdId)}
                    >
                      {copiedKey === household.householdId ? '복사됨' : '키 복사'}
                    </ActionButton>
                    <ActionButton
                      icon={detailOpen
                        ? <ChevronUp className="h-3.5 w-3.5" />
                        : <Settings2 className="h-3.5 w-3.5" />}
                      onClick={() => detailOpen
                        ? onCloseDetails()
                        : void onLoadDetails(household.householdId)}
                    >
                      {detailOpen ? '관리 닫기' : '관리'}
                    </ActionButton>
                    {household.lifecycleState === 'active' ? (
                      <ActionButton
                        danger
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => onDelete(household)}
                      >
                        삭제
                      </ActionButton>
                    ) : (
                      <ActionButton
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        onClick={() => void onRestoreHousehold(household)}
                      >
                        복구
                      </ActionButton>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SummaryItem label="활성 가구원" value={`${household.memberCount}명`} />
                  <SummaryItem label="오늘 접속" value={`${household.todayAccessCount}회`} />
                  <SummaryItem
                    label="누적 접속"
                    value={`${household.totalAccessCount.toLocaleString('ko-KR')}회`}
                  />
                  <SummaryItem
                    label="최근 접속"
                    value={formatDateTime(household.lastAccessAt)}
                    small
                  />
                </div>

                <div className="mt-3 overflow-hidden rounded-lg border border-slate-800/80">
                  <div className="grid grid-cols-[minmax(100px,1fr)_72px_84px_minmax(120px,1fr)] bg-slate-950/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-slate-600">
                    <span>사용자</span>
                    <span className="text-right">오늘</span>
                    <span className="text-right">누적</span>
                    <span className="text-right">최근 접속</span>
                  </div>
                  {household.members.map((member) => (
                    <div
                      key={member.memberId}
                      className="grid grid-cols-[minmax(100px,1fr)_72px_84px_minmax(120px,1fr)] items-center border-t border-slate-800/70 px-3 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="truncate font-medium text-slate-200">
                          {member.displayName}
                        </span>
                        {!member.linkedPrincipal && (
                          <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-500">
                            자산 명의
                          </span>
                        )}
                      </div>
                      <span className="text-right font-mono text-slate-300">
                        {member.todayAccessCount}
                      </span>
                      <span className="text-right font-mono text-slate-400">
                        {member.totalAccessCount.toLocaleString('ko-KR')}
                      </span>
                      <span className="truncate text-right text-[10px] text-slate-500">
                        {formatDateTime(member.lastAccessAt)}
                      </span>
                    </div>
                  ))}
                  {household.members.length === 0 && (
                    <p className="border-t border-slate-800/70 px-3 py-4 text-center text-xs text-slate-600">
                      등록된 가구원이 없습니다.
                    </p>
                  )}
                </div>

                {detailOpen && (
                  <AdminHouseholdOperations
                    loading={detailsLoading}
                    members={members}
                    profiles={profiles}
                    deletedAssets={deletedAssets}
                    onClose={onCloseDetails}
                    onRemoveMember={onRemoveMember}
                    onRestoreMember={onRestoreMember}
                    onArchiveProfile={onArchiveProfile}
                    onRestoreAsset={onRestoreAsset}
                  />
                )}
              </article>
            );
          })}
          {households.length === 0 && (
            <div className="p-12 text-center text-sm text-slate-600">
              등록된 가구가 없습니다.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryItem({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950/30 px-3 py-2.5">
      <p className="text-[10px] text-slate-600">{label}</p>
      <p className={`mt-1 truncate font-medium text-slate-300 ${small ? 'text-[11px]' : 'text-sm'}`}>
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  children,
  icon,
  danger = false,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  danger?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
        danger
          ? 'border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
          : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-700'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
