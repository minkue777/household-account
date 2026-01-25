'use client';

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { createHousehold, getAllHouseholds, deleteHousehold, Household } from '@/lib/householdService';
import { signInWithGoogle, logOut, onAuthChange, isAdmin } from '@/lib/authService';

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [households, setHouseholds] = useState<Household[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 인증 상태 구독
  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadHouseholds = async () => {
    const data = await getAllHouseholds();
    setHouseholds(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    setIsLoading(false);
  };

  useEffect(() => {
    if (user && isAdmin(user)) {
      loadHouseholds();
    }
  }, [user]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const key = await createHousehold(newName || undefined);
      setNewName('');
      await loadHouseholds();

      // 자동으로 클립보드에 복사
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (error) {
      console.error('키 생성 실패:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (confirm(`"${key}" 키를 삭제하시겠습니까?\n해당 가구의 데이터는 삭제되지 않습니다.`)) {
      await deleteHousehold(key);
      await loadHouseholds();
    }
  };

  const handleCopy = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // 로딩 중
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-400">로딩중...</div>
      </div>
    );
  }

  // 로그인 안 됨
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-4xl mb-4">🔐</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">관리자 로그인</h1>
          <p className="text-sm text-slate-500 mb-6">구글 계정으로 로그인하세요</p>
          <button
            onClick={signInWithGoogle}
            className="w-full py-3 bg-white border border-slate-300 rounded-xl font-medium text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google로 로그인
          </button>
        </div>
      </div>
    );
  }

  // 관리자 아님
  if (!isAdmin(user)) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-4xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">접근 권한 없음</h1>
          <p className="text-sm text-slate-500 mb-4">
            {user.email}은(는) 관리자가 아닙니다
          </p>
          <button
            onClick={logOut}
            className="w-full py-3 bg-slate-100 rounded-xl font-medium text-slate-600 hover:bg-slate-200 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  // 관리자 페이지
  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800">관리자</h1>
          <button
            onClick={logOut}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            로그아웃
          </button>
        </div>

        {/* 키 생성 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
          <h2 className="font-semibold text-slate-800 mb-3">새 가구 키 생성</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="가구 이름 (선택)"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-slate-300 transition-colors whitespace-nowrap"
            >
              {isCreating ? '...' : '생성'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            생성된 키는 자동으로 클립보드에 복사됩니다
          </p>
        </div>

        {/* 가구 목록 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">
              등록된 가구 ({households.length})
            </h2>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-slate-400">로딩중...</div>
          ) : households.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              등록된 가구가 없습니다
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {households.map((household) => (
                <div key={household.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-mono font-bold text-slate-800">
                      {household.id}
                    </div>
                    <div className="text-sm text-slate-500">
                      {household.name !== household.id && `${household.name} · `}
                      {household.createdAt.toLocaleDateString('ko-KR')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(household.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        copiedKey === household.id
                          ? 'bg-green-100 text-green-600'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {copiedKey === household.id ? '복사됨' : '복사'}
                    </button>
                    <button
                      onClick={() => handleDelete(household.id)}
                      className="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-sm hover:bg-red-100 transition-colors"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
