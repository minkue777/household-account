'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setStoredHouseholdKey, validateHouseholdKey } from '@/lib/householdService';

export default function JoinPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'invalid' | 'success'>('loading');
  const [manualKey, setManualKey] = useState('');

  useEffect(() => {
    const key = searchParams.get('key');
    if (key) {
      // URL에 key가 있으면 자동 설정
      validateHouseholdKey(key).then((isValid) => {
        if (isValid) {
          setStoredHouseholdKey(key);
          setStatus('success');
          setTimeout(() => router.push('/'), 1000);
        } else {
          setStatus('invalid');
        }
      });
    } else {
      setStatus('invalid');
    }
  }, [searchParams, router]);

  const handleManualJoin = async () => {
    if (!manualKey.trim()) return;

    const isValid = await validateHouseholdKey(manualKey.trim());
    if (isValid) {
      setStoredHouseholdKey(manualKey.trim());
      router.push('/');
    } else {
      alert('유효하지 않은 키입니다.');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-400">확인 중...</div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-green-600 font-medium">설정 완료! 이동 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full">
        <h1 className="text-xl font-bold text-slate-800 mb-4">가구 키 입력</h1>
        <p className="text-sm text-slate-500 mb-4">
          공유받은 가구 키를 입력하세요.
        </p>
        <input
          type="text"
          value={manualKey}
          onChange={(e) => setManualKey(e.target.value)}
          placeholder="가구 키 입력"
          className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        />
        <button
          onClick={handleManualJoin}
          disabled={!manualKey.trim()}
          className="w-full py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors disabled:bg-slate-300"
        >
          접속하기
        </button>
      </div>
    </div>
  );
}
