'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setStoredHouseholdKey } from '@/lib/householdService';

export default function GuestPage() {
  const router = useRouter();

  useEffect(() => {
    // guest 키로 설정하고 메인으로 이동
    setStoredHouseholdKey('guest');
    router.push('/');
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="text-slate-400">guest로 접속 중...</div>
    </div>
  );
}
