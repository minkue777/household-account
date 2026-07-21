'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { shortcutCredentials } from '@/features/payment-capture/application/shortcutCredentials';
import type { ShortcutCredentialIssueResult } from '@/platform/functions-api';

type CredentialStatus = Awaited<ReturnType<typeof shortcutCredentials.status>>;
type IssuedCredential = Extract<ShortcutCredentialIssueResult, { kind: 'issued' }>;

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '단축어 인증 정보를 처리하지 못했습니다.';
}

export default function ShortcutSettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [oneTimeCredential, setOneTimeCredential] = useState<IssuedCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await shortcutCredentials.status());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revealIssuedCredential = async (result: IssuedCredential) => {
    setOneTimeCredential(result);
    setCopied(false);
    setStatus({
      kind: 'found',
      credential: {
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
        status: 'active',
        masked: true,
        issuedAt: result.issuedAt,
      },
    });
    try {
      await navigator.clipboard.writeText(result.rawCredential);
      setCopied(true);
      window.open(result.installUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // 클립보드 권한이 없으면 아래의 명시적 복사 버튼으로 계속 진행합니다.
    }
  };

  const issue = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await shortcutCredentials.issue();
      if (result.kind === 'issued') {
        await revealIssuedCredential(result);
      } else {
        await refresh();
        setError('이미 발급된 키는 다시 볼 수 없습니다. 필요하면 재발급해 주세요.');
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setWorking(false);
    }
  };

  const reissue = async () => {
    if (status?.kind !== 'found') return;
    if (!window.confirm('기존 단축어 키는 즉시 사용할 수 없게 됩니다. 새로 발급할까요?')) return;
    setWorking(true);
    setError(null);
    try {
      const result = await shortcutCredentials.reissue(
        status.credential.credentialId,
        status.credential.credentialVersion
      );
      if (result.kind === 'issued') await revealIssuedCredential(result);
      else {
        setOneTimeCredential(null);
        await refresh();
        setError('다른 요청에서 이미 재발급되었습니다. 새 키는 다시 볼 수 없습니다.');
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setWorking(false);
    }
  };

  const revoke = async () => {
    if (status?.kind !== 'found') return;
    if (!window.confirm('이 단축어의 결제 등록을 중지할까요?')) return;
    setWorking(true);
    setError(null);
    try {
      await shortcutCredentials.revoke(
        status.credential.credentialId,
        status.credential.credentialVersion
      );
      setOneTimeCredential(null);
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setWorking(false);
    }
  };

  const copyCredential = async () => {
    if (!oneTimeCredential) return;
    try {
      await navigator.clipboard.writeText(oneTimeCredential.rawCredential);
      setCopied(true);
    } catch {
      setError('클립보드에 복사하지 못했습니다. 키를 길게 눌러 직접 복사해 주세요.');
    }
  };

  const active = status?.kind === 'found' && status.credential.status === 'active';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100">
          <KeyRound className="h-5 w-5 text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-800">iPhone 결제 자동 등록</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            단축어 키를 한 번 복사한 뒤 설치 화면에서 붙여 넣어 주세요.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-slate-400">상태를 확인하고 있습니다…</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {!active && (
            <button
              type="button"
              disabled={working}
              onClick={() => void issue()}
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:bg-slate-300"
            >
              {working ? '발급 중…' : '키 발급 및 설치'}
            </button>
          )}
          {active && (
            <>
              <button
                type="button"
                disabled={working}
                onClick={() => void reissue()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
              >
                <RefreshCw className="h-4 w-4" /> 재발급
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => void revoke()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-sm text-red-500 hover:bg-red-50 disabled:text-slate-300"
              >
                <Trash2 className="h-4 w-4" /> 폐기
              </button>
            </>
          )}
        </div>
      )}

      {active && !oneTimeCredential && (
        <div className="mt-3 text-xs text-slate-400">
          <p>키가 발급되어 있습니다. 보안을 위해 기존 키의 원문은 다시 표시하지 않습니다.</p>
          {status?.kind === 'found' && (
            <p className="mt-1">
              발급 {new Date(status.credential.issuedAt).toLocaleString('ko-KR')}
              {status.credential.lastUsedAt
                ? ` · 최근 사용 ${new Date(status.credential.lastUsedAt).toLocaleString('ko-KR')}`
                : ' · 아직 사용되지 않음'}
            </p>
          )}
        </div>
      )}

      {status?.kind === 'found' && status.credential.status === 'revoked' && (
        <p className="mt-3 text-xs text-slate-400">기존 단축어 키가 폐기되었습니다.</p>
      )}

      {oneTimeCredential && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">이 키는 지금 한 번만 확인할 수 있습니다.</p>
          <code className="mt-2 block break-all rounded-lg bg-white p-2 text-xs text-slate-700">
            {oneTimeCredential.rawCredential}
          </code>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyCredential()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              <Copy className="h-4 w-4" /> {copied ? '복사됨' : '키 복사'}
            </button>
            <a
              href={oneTimeCredential.installUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              <ExternalLink className="h-4 w-4" /> 설치 화면 열기
            </a>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </section>
  );
}
