'use client';

import { useEffect, useRef, useState } from 'react';

/** 저장 성공만 폼을 닫고, 실패하면 같은 입력과 오류를 남깁니다. */
export function useSettingsMutation(scope: string | null | undefined) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const session = useRef({ busy: false });
  useEffect(() => {
    const current = { busy: false };
    session.current = current;
    setPending(false);
    setError('');
    return () => { session.current = { busy: false }; };
  }, [scope]);

  async function run(save: () => Promise<unknown>, onSuccess: () => void = () => {}) {
    const current = session.current;
    if (current.busy) return;
    current.busy = true;
    setPending(true);
    setError('');
    try {
      await save();
      if (session.current === current) onSuccess();
    } catch (failure) {
      if (session.current === current) setError(failure instanceof Error ? failure.message : '저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      current.busy = false;
      if (session.current === current) setPending(false);
    }
  }
  return { pending, error, clearError: () => setError(''), run };
}
