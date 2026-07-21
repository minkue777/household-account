'use client';

import Link from 'next/link';

export default function JoinPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-lg font-bold text-slate-800">이미 가계부에 연결되어 있습니다</h1>
        <p className="mt-2 text-sm text-slate-500">
          한 Google 계정은 하나의 가계부만 사용합니다. 다른 초대 코드를 사용하려면 현재 계정에서 로그아웃해 주세요.
        </p>
        <Link href="/" className="mt-5 block rounded-xl bg-blue-500 py-3 font-medium text-white hover:bg-blue-600">
          가계부로 돌아가기
        </Link>
      </div>
    </main>
  );
}
