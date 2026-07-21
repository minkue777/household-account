'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';

type FirstVisitMode = 'choose' | 'create' | 'join';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 완료하지 못했습니다.';
}

export default function HouseholdLogin() {
  const {
    sessionState,
    sessionError,
    legacyCandidate,
    signIn,
    retrySession,
    confirmLegacyMembership,
    createHouseholdForSelf,
    joinHouseholdAsSelf,
    logout,
  } = useHousehold();
  const [mode, setMode] = useState<FirstVisitMode>('choose');
  const [householdName, setHouseholdName] = useState('');
  const [memberName, setMemberName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') ?? params.get('invite');
    if (code?.trim()) {
      setInvitationCode(code.trim());
      setMode('join');
    }
  }, []);

  const run = async (action: () => Promise<void>) => {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await action();
    } catch (error) {
      setLocalError(describeError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!householdName.trim() || !memberName.trim()) return;
    await run(() => createHouseholdForSelf(householdName, memberName));
  };

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    if (!invitationCode.trim() || !memberName.trim()) return;
    await run(() => joinHouseholdAsSelf(invitationCode, memberName));
  };

  const error = localError ?? sessionError;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mb-2 text-4xl">🏠</div>
          <h1 className="text-xl font-bold text-slate-800">가계부</h1>
        </div>

        {sessionState === 'signed-out' && (
          <div>
            <p className="mb-5 text-center text-sm text-slate-500">
              Google 계정으로 로그인하면 본인의 가계부가 바로 연결됩니다.
            </p>
            <button
              type="button"
              onClick={() => void run(signIn)}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-slate-300 bg-white py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? '로그인 중...' : 'Google로 로그인'}
            </button>
          </div>
        )}

        {sessionState === 'error' && (
          <div className="space-y-3">
            <p className="text-center text-sm text-slate-500">
              로그인 정보는 유지되어 있습니다. 서버 연결을 다시 확인해 주세요.
            </p>
            <button
              type="button"
              onClick={() => void run(retrySession)}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => void run(logout)}
              disabled={isSubmitting}
              className="w-full py-2 text-sm text-slate-500 hover:text-slate-700"
            >
              로그아웃
            </button>
          </div>
        )}

        {sessionState === 'legacy-confirmation' && legacyCandidate && (
          <div>
            <h2 className="mb-2 text-center font-semibold text-slate-800">기존 가계부 연결 확인</h2>
            <p className="mb-4 text-center text-sm text-slate-500">
              이 기기에서 사용하던 가계부와 Google 계정을 한 번만 연결합니다.
            </p>
            <div className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              <div>사용자: {legacyCandidate.legacyMemberName || legacyCandidate.legacyMemberId}</div>
              <div className="mt-1 truncate text-xs text-slate-400">
                가계부 ID: {legacyCandidate.legacyHouseholdId}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void run(confirmLegacyMembership)}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            >
              {isSubmitting ? '연결 중...' : '기존 가계부 연결'}
            </button>
            <button
              type="button"
              onClick={() => void run(logout)}
              disabled={isSubmitting}
              className="mt-2 w-full py-2 text-sm text-slate-500 hover:text-slate-700"
            >
              다른 Google 계정 사용
            </button>
          </div>
        )}

        {sessionState === 'first-visit' && mode === 'choose' && (
          <div className="space-y-3">
            <p className="mb-4 text-center text-sm text-slate-500">처음 사용할 방법을 선택해 주세요.</p>
            <button
              type="button"
              onClick={() => setMode('create')}
              className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white hover:bg-blue-600"
            >
              새 가계부 만들기
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="w-full rounded-xl border border-slate-300 py-3 font-medium text-slate-700 hover:bg-slate-50"
            >
              초대 코드 입력하기
            </button>
            <button
              type="button"
              onClick={() => void run(logout)}
              className="w-full py-2 text-sm text-slate-400 hover:text-slate-600"
            >
              로그아웃
            </button>
          </div>
        )}

        {sessionState === 'first-visit' && mode === 'create' && (
          <form onSubmit={(event) => void submitCreate(event)} className="space-y-3">
            <h2 className="text-center font-semibold text-slate-800">새 가계부 만들기</h2>
            <input
              value={householdName}
              onChange={(event) => setHouseholdName(event.target.value)}
              placeholder="가계부 이름"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <input
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              placeholder="내 이름"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isSubmitting || !householdName.trim() || !memberName.trim()}
              className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white hover:bg-blue-600 disabled:bg-slate-300"
            >
              {isSubmitting ? '생성 중...' : '가계부 만들기'}
            </button>
            <button type="button" onClick={() => setMode('choose')} className="w-full py-2 text-sm text-slate-500">
              이전
            </button>
          </form>
        )}

        {sessionState === 'first-visit' && mode === 'join' && (
          <form onSubmit={(event) => void submitJoin(event)} className="space-y-3">
            <h2 className="text-center font-semibold text-slate-800">초대받은 가계부 참여</h2>
            <input
              value={invitationCode}
              onChange={(event) => setInvitationCode(event.target.value)}
              placeholder="5분 동안 유효한 초대 코드"
              autoCapitalize="characters"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <input
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              placeholder="내 이름"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isSubmitting || !invitationCode.trim() || !memberName.trim()}
              className="w-full rounded-xl bg-blue-500 py-3 font-medium text-white hover:bg-blue-600 disabled:bg-slate-300"
            >
              {isSubmitting ? '참여 중...' : '참여하기'}
            </button>
            <button type="button" onClick={() => setMode('choose')} className="w-full py-2 text-sm text-slate-500">
              이전
            </button>
          </form>
        )}

        {error && sessionState !== 'resolving' && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-center text-sm text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}
