'use client';

import { useState, useEffect } from 'react';
import { createHousehold, getAllHouseholds, deleteHousehold, Household, migrateExpensesToHousehold } from '@/lib/householdService';

export default function AdminPage() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  const loadHouseholds = async () => {
    const data = await getAllHouseholds();
    setHouseholds(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    setIsLoading(false);
  };

  useEffect(() => {
    loadHouseholds();
  }, []);

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

  const handleMigrate = async (key: string) => {
    if (!confirm(`"${key}"로 기존 데이터를 마이그레이션하시겠습니까?`)) return;

    setIsMigrating(true);
    setMigrateResult(null);

    try {
      const count = await migrateExpensesToHousehold(key);
      setMigrateResult(`${count}개 문서 마이그레이션 완료`);
    } catch (error) {
      setMigrateResult('마이그레이션 실패');
      console.error(error);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">관리자</h1>

        {migrateResult && (
          <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded-xl text-sm">
            {migrateResult}
          </div>
        )}

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
                      onClick={() => handleMigrate(household.id)}
                      disabled={isMigrating}
                      className="px-3 py-1.5 bg-blue-50 text-blue-500 rounded-lg text-sm hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      {isMigrating ? '...' : '마이그레이션'}
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
