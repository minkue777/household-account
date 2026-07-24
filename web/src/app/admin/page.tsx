'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Gauge, LogOut, Plus, ShieldCheck } from 'lucide-react';

import { AdminHouseholdList } from '@/components/admin/AdminHouseholdList';
import { AdminOperationsOverview } from '@/components/admin/AdminOperationsOverview';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { useAppDialog } from '@/contexts/AppDialogContext';
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
  type AdminOperationsDashboardWireView,
  type AssetOwnerProfileWireView,
} from '@/platform/functions-api';

export default function AdminPage() {
  const { showConfirm, showPrompt } = useAppDialog();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dashboard, setDashboard] = useState<AdminOperationsDashboardWireView | null>(null);
  const [requestLatencyMs, setRequestLatencyMs] = useState<number | null>(null);
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

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const startedAt = performance.now();
    try {
      const result = await adminHouseholds.dashboard(14);
      setDashboard(result);
      setRequestLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
      setAccessDenied(false);
    } catch (error) {
      if (
        error instanceof AdminAccessError
        && (error.code === 'ADMIN_CAPABILITY_REQUIRED' || error.code === 'AUTH_REQUIRED')
      ) {
        setAccessDenied(true);
        setDashboard(null);
      } else {
        setErrorMessage('운영 대시보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadDashboard();
  }, [loadDashboard, user]);

  useEffect(() => {
    if (!user || accessDenied) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDashboard();
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [accessDenied, loadDashboard, user]);

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
      await loadDashboard();
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
      await adminHouseholds.delete(
        pendingDelete.householdId,
        pendingDelete.aggregateVersion
      );
      setPendingDelete(null);
      await loadDashboard();
    } catch {
      setErrorMessage('가구를 삭제 상태로 전환하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRestoreHousehold = async (household: AdminHouseholdWireView) => {
    const reason = await showPrompt({
      title: '가구 복구',
      message: '가구 복구 사유를 입력해 주세요.',
      placeholder: '복구 사유',
      confirmLabel: '복구',
    });
    if (!reason?.trim()) return;
    try {
      await adminHouseholds.restore(
        household.householdId,
        household.aggregateVersion,
        reason
      );
      await loadDashboard();
    } catch {
      setErrorMessage('가구를 복구하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRemoveMember = async (member: AdminMemberWireView) => {
    if (!detailHouseholdId) return;
    const reason = await showPrompt({
      title: '가구원 제거',
      message: `${member.displayName} 가구원 제거 사유를 입력해 주세요.`,
      placeholder: '제거 사유',
      confirmLabel: '제거',
      variant: 'danger',
    });
    if (!reason?.trim()) return;
    try {
      await adminHouseholds.removeMember(
        detailHouseholdId,
        member.memberId,
        member.aggregateVersion,
        reason
      );
      await Promise.all([refreshDetails(), loadDashboard()]);
    } catch {
      setErrorMessage('가구원을 제거하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  const handleRestoreMember = async (member: AdminMemberWireView) => {
    if (!detailHouseholdId) return;
    const confirmed = await showConfirm({
      title: '가구원 복구',
      message: `${member.displayName} 가구원을 복구할까요?`,
      confirmLabel: '복구',
    });
    if (!confirmed) return;
    try {
      await adminHouseholds.restoreMember(
        detailHouseholdId,
        member.memberId,
        member.aggregateVersion
      );
      await Promise.all([refreshDetails(), loadDashboard()]);
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
    const reason = await showPrompt({
      title: '자산 복구',
      message: `${asset.name} 자산 복구 사유를 입력해 주세요.`,
      placeholder: '복구 사유',
      confirmLabel: '복구',
    });
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

  if (authLoading) {
    return <CenteredCard>로그인 상태를 확인하는 중입니다.</CenteredCard>;
  }
  if (!user) {
    return (
      <CenteredCard>
        <ShieldCheck className="mx-auto mb-4 h-8 w-8 text-sky-400" />
        <h1 className="mb-2 text-xl font-semibold text-slate-100">관리자 로그인</h1>
        <p className="mb-6 text-sm text-slate-500">
          관리자 권한이 부여된 Google 계정으로 로그인해 주세요.
        </p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="w-full rounded-lg bg-sky-500 py-3 font-medium text-white transition hover:bg-sky-400"
        >
          Google로 로그인
        </button>
      </CenteredCard>
    );
  }
  if (accessDenied) {
    return (
      <CenteredCard>
        <h1 className="mb-2 text-xl font-semibold text-slate-100">접근 권한 없음</h1>
        <p className="mb-4 text-sm text-slate-500">
          이 계정에는 서버에서 검증된 관리자 권한이 없습니다.
        </p>
        <button
          type="button"
          onClick={() => void logOut()}
          className="w-full rounded-lg bg-slate-800 py-3 text-slate-300"
        >
          로그아웃
        </button>
      </CenteredCard>
    );
  }

  return (
    <main className="min-h-screen bg-[#080c14] text-slate-200">
      <div className="border-b border-slate-800/80 bg-slate-950/70 px-4 backdrop-blur">
        <header className="mx-auto flex max-w-[1440px] items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-300 ring-1 ring-inset ring-sky-400/20">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-100">
                Household Operations
              </h1>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">
                Admin dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-600 sm:block">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => void logOut()}
              className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              로그아웃
            </button>
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-[1440px] space-y-3 p-3 sm:p-5">
        {errorMessage && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {errorMessage}
          </div>
        )}

        {dashboard ? (
          <AdminOperationsOverview
            dashboard={dashboard}
            requestLatencyMs={requestLatencyMs}
            refreshing={isLoading}
            onRefresh={() => void loadDashboard()}
          />
        ) : (
          <DashboardSkeleton />
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl shadow-black/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">가구 생성</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                운영 목적으로 빈 가계부를 생성합니다.
              </p>
            </div>
            <div className="flex w-full gap-2 sm:max-w-md">
              <input
                value={newHouseholdName}
                onChange={(event) => setNewHouseholdName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate();
                }}
                placeholder="가구 이름"
                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-700 focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isCreating || !newHouseholdName.trim()}
                className="flex items-center gap-1.5 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-600"
              >
                <Plus className="h-4 w-4" />
                {isCreating ? '생성 중' : '생성'}
              </button>
            </div>
          </div>
        </section>

        <AdminHouseholdList
          households={dashboard?.households ?? []}
          isLoading={isLoading && dashboard === null}
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
    <main className="flex min-h-screen items-center justify-center bg-[#080c14] p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        {children}
      </div>
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3" aria-label="운영 대시보드를 불러오는 중">
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-44 animate-pulse rounded-xl border border-slate-800 bg-slate-900/70"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-slate-800 bg-slate-900/70" />
    </div>
  );
}
