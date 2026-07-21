'use client';

import { useState } from 'react';
import { Copy, UserPlus } from 'lucide-react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { householdCommands } from '@/features/access-household/application/householdCommands';

interface InvitationView {
  invitationCode: string;
  expiresAt: string;
}

export default function InvitationSettings() {
  const { householdKey } = useHousehold();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const issueInvitation = async () => {
    if (!householdKey) return;
    setIsIssuing(true);
    setError(null);
    try {
      const result = await householdCommands.createInvitation(householdKey);
      setInvitation(result);
      setCopied(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '초대 코드를 만들지 못했습니다.');
    } finally {
      setIsIssuing(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitation) return;
    await navigator.clipboard.writeText(invitation.invitationCode);
    setCopied(true);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
          <UserPlus className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-slate-800">가구원 초대</div>
          <div className="text-sm text-slate-500">5분간 유효한 초대 코드</div>
        </div>
        <button
          type="button"
          onClick={() => void issueInvitation()}
          disabled={isIssuing || !householdKey}
          className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:bg-slate-300"
        >
          {isIssuing ? '생성 중...' : invitation ? '새로 생성' : '코드 생성'}
        </button>
      </div>

      {invitation && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-center text-lg font-bold tracking-wider text-slate-800">
              {invitation.invitationCode}
            </code>
            <button
              type="button"
              onClick={() => void copyInvitation()}
              className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-blue-500"
              aria-label="초대 코드 복사"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-center text-xs text-slate-400">
            {copied ? '복사했습니다 · ' : ''}{new Date(invitation.expiresAt).toLocaleTimeString('ko-KR')}까지 유효
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
