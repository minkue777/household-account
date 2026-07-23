'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

import { AdminHouseholdList } from '@/components/admin/AdminHouseholdList';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { adminHouseholds } from '@/features/access-household/application/adminHouseholds';
import {
  clearAdminHouseholdViewSelection,
  selectAdminHouseholdView,
} from '@/features/access-household/application/adminHouseholdViewSelection';
import { assetOwnerProfiles } from '@/features/access-household/application/assetOwnerProfiles';
import { logOut, onAuthChange, signInWithGoogle } from '@/lib/authService';
import {
  AdminAccessError,
  type AdminDeletedAssetWireView,
  type AdminHouseholdWireView,
  type AdminMemberWireView,
  type AssetOwnerProfileWireView,
} from '@/platform/functions-api';

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [households, setHouseholds] = useState<AdminHouseholdWireView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminHouseholdWireView | null>(null);
  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [detailHouseholdId, setDetailHouseholdId] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [members, setMembers] = useState<AdminMemberWireView[]>([]);
  const [profiles, setProfiles] = useState<AssetOwnerProfileWireView[]>([]);
  const [deletedAssets, setDeletedAssets] = useState<AdminDeletedAssetWireView[]>([]);

  useEffect(() => {
    clearAdminHouseholdViewSelection();
  }, []);

  useEffect(
    () =>
      onAuthChange((nextUser) => {
        setUser(nextUser);
        setAuthLoading(false);
        setAccessDenied(false);
        setErrorMessage(null);
      }),
    []
  );

  const loadHouseholds = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const all: AdminHouseholdWireView[] = [];
      let cursor: string | undefined;
      do {
        const page = await adminHouseholds.list(cursor);
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      setHouseholds(all);
      setAccessDenied(false);
    } catch (error) {
      if (
        error instanceof AdminAccessError &&
        (error.code === 'ADMIN_CAPABILITY_REQUIRED' || error.code === 'AUTH_REQUIRED')
      ) {
        setAccessDenied(true);
        setHouseholds([]);
      } else {
        setErrorMessage('가구 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadHouseholds();
  }, [loadHouseholds, user]);

  const loadDetails = useCallback(async (householdId: string) => {
    setDetailHouseholdId(householdId);
    setDetailsLoading(true);
    setErrorMessage(null);
    try {
      const [memberResult, profileResult, assetResult] = await Promise.all([
        adminHouseholds.listMembers(householdId),
        assetOwnerProfiles.list(householdId, true),
        adminHouseholds.listDeletedAssets(householdId),
      ]);
      setMembers(memberResult.members);
      setProfiles(profileResult.profiles);
      setDeletedAssets(assetResult.assets);
    } catch {
      setMembers([]);
      setProfiles([]);
      setDeletedAssets([]);
      setErrorMessage('가구 운영 정보를 불러오지 못했습니다.');
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const refreshDetails = async () => {
    if (detailHouseholdId) await loadDetails(detailHouseholdId);
  };

  const handleCreate = async () => {
    const name = newHouseholdName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    setErrorMessage(null);
    try {
      await adminHouseholds.create(name);
      setNewHouseholdName('');
      await loadHouseholds();
    } catch {
      setErrorMessage('가구를 생성하지 못했습니다.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async (householdId: string) => {
    try {
      const { legacyShareKey } = await adminHouseholds.getLegacyShareKey(householdId);
      await navigator.clipboard.writeText(legacyShareKey);
      setCopiedKey(householdId);
      window.setTimeout(() => setCopiedKey(null), 2_000);
    } catch {
      setErrorMessage('가구 키를 복사하지 못했습니다.');
    }
  };

  const handleOpenHousehold = (household: AdminHouseholdWireView) => {
    selectAdminHouseholdView({
      householdId: household.householdId,
      householdName: household.name,
    });
    window.location.assign('/');
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await adminHouseholds.delete(pendingDelete.householdId, pendingDelete.aggregateVersion);
      setPendingDelete(null);
      await loadHouseholds();
    } catch {
      setErrorMessage('가구를 삭제 상태로 전환하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRestoreHousehold = async (household: AdminHouseholdWireView) => {
    const reason = window.prompt('가구 복구 사유를 입력해 주세요.');
    if (!reason?.trim()) return;
    try {
      await adminHouseholds.restore(household.householdId, household.aggregateVersion, reason);
      await loadHouseholds();
    } catch {
      setErrorMessage('가구를 복구하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRemoveMember = async (member: AdminMemberWireView) => {
    if (!detailHouseholdId) return;
    const reason = window.prompt(`${member.displayName} 가구원 제거 사유를 입력해 주세요.`);
    if (!reason?.trim()) return;
    try {
      await adminHouseholds.removeMember(
        detailHouseholdId,
        member.memberId,
        member.aggregateVersion,
        reason
      );
      await refreshDetails();
    } catch {
      setErrorMessage('가구원을 제거하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRestoreMember = async (member: AdminMemberWireView) => {
    if (!detailHouseholdId || !window.confirm(`${member.displayName} 가구원을 복구할까요?`)) return;
    try {
      await adminHouseholds.restoreMember(
        detailHouseholdId,
        member.memberId,
        member.aggregateVersion
      );
      await refreshDetails();
    } catch {
      setErrorMessage('가구원을 복구하지 못했습니다. 다른 가구 가입 여부를 확인해 주세요.');
    }
  };

  const handleArchiveProfile = async (profile: AssetOwnerProfileWireView) => {
    if (!detailHouseholdId) return;
    try {
      await assetOwnerProfiles.archive(
        detailHouseholdId,
        profile.profileId,
        profile.aggregateVersion
      );
      await refreshDetails();
    } catch {
      setErrorMessage('명의자를 보관하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRestoreAsset = async (asset: AdminDeletedAssetWireView) => {
    if (!detailHouseholdId) return;
    const reason = window.prompt(`${asset.name} 자산 복구 사유를 입력해 주세요.`);
    if (!reason?.trim()) return;
    try {
      await adminHouseholds.restoreDeletedAsset(
        detailHouseholdId,
        asset.assetId,
        asset.aggregateVersion,
        reason
      );
      await refreshDetails();
    } catch {
      setErrorMessage('자산을 복구하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  if (authLoading) return <CenteredCard>로그인 상태를 확인하는 중입니다.</CenteredCard>;
  if (!user) {
    return (
      <CenteredCard>
        <h1 className="mb-2 text-xl font-bold text-slate-800">관리자 로그인</h1>
        <p className="mb-6 text-sm text-slate-500">
          관리자 권한이 부여된 Google 계정으로 로그인해 주세요.
        </p>
        <button
          onClick={() => void signInWithGoogle()}
          className="w-full rounded-xl border border-slate-300 bg-white py-3 font-medium text-slate-700 hover:bg-slate-50"
        >
          Google로 로그인
        </button>
      </CenteredCard>
    );
  }
  if (accessDenied) {
    return (
      <CenteredCard>
        <h1 className="mb-2 text-xl font-bold text-slate-800">접근 권한 없음</h1>
        <p className="mb-4 text-sm text-slate-500">
          이 계정에는 서버에서 검증된 관리자 권한이 없습니다.
        </p>
        <button onClick={() => void logOut()} className="w-full rounded-xl bg-slate-100 py-3">
          로그아웃
        </button>
      </CenteredCard>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-center justify-between py-2">
          <h1 className="text-2xl font-bold text-slate-800">관리자</h1>
          <button onClick={() => void logOut()} className="text-sm text-slate-500">로그아웃</button>
        </header>

        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-800">가구 생성</h2>
          <div className="flex gap-2">
            <input
              value={newHouseholdName}
              onChange={(event) => setNewHouseholdName(event.target.value)}
              placeholder="가구 이름"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={isCreating || !newHouseholdName.trim()}
              className="rounded-lg bg-blue-500 px-4 py-2 text-white disabled:bg-slate-300"
            >
              {isCreating ? '생성 중' : '생성'}
            </button>
          </div>
        </section>

        <AdminHouseholdList
          households={households}
          isLoading={isLoading}
          copiedKey={copiedKey}
          detailHouseholdId={detailHouseholdId}
          detailsLoading={detailsLoading}
          members={members}
          profiles={profiles}
          deletedAssets={deletedAssets}
          onCopy={handleCopy}
          onOpenHousehold={handleOpenHousehold}
          onLoadDetails={loadDetails}
          onCloseDetails={() => setDetailHouseholdId(null)}
          onDelete={setPendingDelete}
          onRestoreHousehold={handleRestoreHousehold}
          onRemoveMember={handleRemoveMember}
          onRestoreMember={handleRestoreMember}
          onArchiveProfile={handleArchiveProfile}
          onRestoreAsset={handleRestoreAsset}
        />
      </div>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="가구를 삭제할까요?"
        message="일반 사용자의 접근을 차단하고 데이터는 관리자 복구를 위해 보존합니다."
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">{children}</div>
    </main>
  );
}
