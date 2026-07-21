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
    <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">운영 작업</span>
        <button onClick={onClose} className="text-xs text-slate-400">
          닫기
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중입니다.</p>
      ) : (
        <>
          <OperationGroup title="가구원">
            {members.map((member) => (
              <OperationRow
                key={member.memberId}
                label={`${member.displayName} · ${member.lifecycleState === 'active' ? '활성' : '제거됨'}`}
              >
                {member.lifecycleState === 'active' ? (
                  <button
                    className="text-red-500"
                    onClick={() => void onRemoveMember(member)}
                  >
                    제거
                  </button>
                ) : (
                  <button
                    className="text-blue-600"
                    onClick={() => void onRestoreMember(member)}
                  >
                    복구
                  </button>
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
                {profile.profileType === 'dependent' &&
                  profile.lifecycleState === 'active' && (
                    <button
                      className="text-red-500"
                      onClick={() => void onArchiveProfile(profile)}
                    >
                      보관
                    </button>
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
                <button
                  className="text-blue-600"
                  onClick={() => void onRestoreAsset(asset)}
                >
                  복구
                </button>
              </OperationRow>
            ))}
            {deletedAssets.length === 0 && (
              <p className="text-sm text-slate-400">삭제된 자산이 없습니다.</p>
            )}
          </OperationGroup>
        </>
      )}
    </div>
  );
}

function OperationGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase text-slate-400">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function OperationRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
      <span className="text-slate-700">{label}</span>
      {children}
    </div>
  );
}
