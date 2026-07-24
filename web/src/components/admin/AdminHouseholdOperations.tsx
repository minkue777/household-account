'use client';

import type { ReactNode } from 'react';

import type {
  AdminDeletedAssetWireView,
  AdminMemberWireView,
  AssetOwnerProfileWireView,
} from '@/platform/functions-api';

interface AdminHouseholdOperationsProps {
  loading: boolean;
  members: AdminMemberWireView[];
  profiles: AssetOwnerProfileWireView[];
  deletedAssets: AdminDeletedAssetWireView[];
  onClose(): void;
  onRemoveMember(member: AdminMemberWireView): Promise<void>;
  onRestoreMember(member: AdminMemberWireView): Promise<void>;
  onArchiveProfile(profile: AssetOwnerProfileWireView): Promise<void>;
  onRestoreAsset(asset: AdminDeletedAssetWireView): Promise<void>;
}

export function AdminHouseholdOperations({
  loading,
  members,
  profiles,
  deletedAssets,
  onClose,
  onRemoveMember,
  onRestoreMember,
  onArchiveProfile,
  onRestoreAsset,
}: AdminHouseholdOperationsProps) {
  return (
    <div className="mt-4 space-y-4 rounded-lg border border-slate-700 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-slate-200">관리자 작업</span>
          <p className="mt-0.5 text-[10px] text-slate-600">
            삭제·복구 작업은 가계 데이터에 반영됩니다.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">
          닫기
        </button>
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-600">운영 정보를 불러오는 중입니다.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <OperationGroup title="가구원">
            {members.map((member) => (
              <OperationRow
                key={member.memberId}
                label={`${member.displayName} · ${member.lifecycleState === 'active' ? '활성' : '제거됨'}`}
              >
                {member.lifecycleState === 'active' ? (
                  <OperationButton danger onClick={() => void onRemoveMember(member)}>
                    제거
                  </OperationButton>
                ) : (
                  <OperationButton onClick={() => void onRestoreMember(member)}>
                    복구
                  </OperationButton>
                )}
              </OperationRow>
            ))}
          </OperationGroup>
          <OperationGroup title="자산 명의자">
            {profiles.map((profile) => (
              <OperationRow
                key={profile.profileId}
                label={`${profile.displayName} · ${profile.lifecycleState === 'active' ? '활성' : '보관됨'}`}
              >
                {profile.profileType === 'dependent'
                  && profile.lifecycleState === 'active' && (
                  <OperationButton danger onClick={() => void onArchiveProfile(profile)}>
                    보관
                  </OperationButton>
                )}
              </OperationRow>
            ))}
          </OperationGroup>
          <OperationGroup title="삭제 자산">
            {deletedAssets.map((asset) => (
              <OperationRow
                key={asset.assetId}
                label={`${asset.name} · v${asset.aggregateVersion}`}
              >
                <OperationButton onClick={() => void onRestoreAsset(asset)}>
                  복구
                </OperationButton>
              </OperationRow>
            ))}
            {deletedAssets.length === 0 && (
              <p className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-600">
                삭제된 자산이 없습니다.
              </p>
            )}
          </OperationGroup>
        </div>
      )}
    </div>
  );
}

function OperationGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function OperationRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
      <span className="min-w-0 truncate text-slate-400">{label}</span>
      {children}
    </div>
  );
}

function OperationButton({
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
      type="button"
      className={danger ? 'text-rose-400 hover:text-rose-300' : 'text-sky-400 hover:text-sky-300'}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
