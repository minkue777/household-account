'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import ModalOverlay from '@/components/common/ModalOverlay';
import type { AssetOwnerProfileWireView } from '@/platform/functions-api';

export default function AssetOwnerProfileModal({
  isOpen,
  profiles,
  onClose,
  onCreate,
  onRename,
}: {
  isOpen: boolean;
  profiles: AssetOwnerProfileWireView[];
  onClose(): void;
  onCreate(displayName: string): Promise<void>;
  onRename(profile: AssetOwnerProfileWireView, displayName: string): Promise<void>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const create = async () => {
    const name = displayName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name);
      setDisplayName('');
    } catch {
      setError('명의자를 추가하지 못했습니다. 이름과 최신 상태를 확인해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const rename = async (profile: AssetOwnerProfileWireView) => {
    const name = window.prompt('새 명의자 이름을 입력해 주세요.', profile.displayName)?.trim();
    if (!name || name === profile.displayName) return;
    setError(null);
    try {
      await onRename(profile, name);
    } catch {
      setError('명의자 이름을 변경하지 못했습니다. 최신 상태를 확인해 주세요.');
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">자산 명의자 추가</h2>
            <p className="mt-1 text-xs text-slate-500">
              로그인 계정이나 가구원 권한은 만들지 않습니다.
            </p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder="이름"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            onClick={() => void create()}
            disabled={submitting || !displayName.trim()}
            className="rounded-lg bg-blue-500 px-4 py-2 text-white disabled:bg-slate-300"
          >
            추가
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

        <div className="mt-5 space-y-2">
          <p className="text-xs font-medium text-slate-400">비로그인 명의자</p>
          {profiles
            .filter((profile) => profile.profileType === 'dependent')
            .map((profile) => (
              <div
                key={profile.profileId}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">{profile.displayName}</span>
                <button onClick={() => void rename(profile)} className="text-blue-600">
                  이름 변경
                </button>
              </div>
            ))}
          {profiles.every((profile) => profile.profileType !== 'dependent') && (
            <p className="text-sm text-slate-400">추가된 비로그인 명의자가 없습니다.</p>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
