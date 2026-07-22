'use client';

import type { ReactNode } from 'react';

import type {
  AdminDeletedAssetWireView,
  AdminHouseholdWireView,
  AdminMemberWireView,
  AssetOwnerProfileWireView,
} from '@/platform/functions-api';

import { AdminHouseholdOperations } from './AdminHouseholdOperations';

interface AdminHouseholdListProps {
  households: AdminHouseholdWireView[];
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4">
        <h2 className="font-semibold text-slate-800">등록된 가구 ({households.length})</h2>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-slate-400">불러오는 중입니다.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {households.map((household) => (
            <div key={household.householdId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-800">
                      {household.name}
                    </span>
                    {household.lifecycleState === 'deleted' && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-500">
                        삭제됨
                      </span>
                    )}
                  </div>
                  <p className="break-all font-mono text-xs text-slate-400">
                    {household.householdId}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <ActionButton onClick={() => onOpenHousehold(household)}>
                    가계부 열기
                  </ActionButton>
                  <ActionButton onClick={() => void onCopy(household.householdId)}>
                    {copiedKey === household.householdId ? '복사됨' : '키 복사'}
                  </ActionButton>
                  <ActionButton onClick={() => void onLoadDetails(household.householdId)}>
                    운영
                  </ActionButton>
                  {household.lifecycleState === 'active' ? (
                    <ActionButton danger onClick={() => onDelete(household)}>
                      삭제
                    </ActionButton>
                  ) : (
                    <ActionButton onClick={() => void onRestoreHousehold(household)}>
                      복구
                    </ActionButton>
                  )}
                </div>
              </div>
              {detailHouseholdId === household.householdId && (
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
            </div>
          ))}
          {households.length === 0 && (
            <div className="p-8 text-center text-slate-400">등록된 가구가 없습니다.</div>
          )}
        </div>
      )}
    </section>
  );
}

function ActionButton({
  children,
  danger = false,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  onClick(): void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm ${danger ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-600'}`}
    >
      {children}
    </button>
  );
}
