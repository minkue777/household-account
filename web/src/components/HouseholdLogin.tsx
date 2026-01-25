'use client';

import { useState } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';

export default function HouseholdLogin() {
  const { login } = useHousehold();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setIsLoading(true);
    setError('');

    const success = await login(key.trim());

    if (!success) {
      setError('유효하지 않은 키입니다');
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🏠</div>
          <h1 className="text-xl font-bold text-slate-800">가계부</h1>
          <p className="text-sm text-slate-500 mt-1">가구 키를 입력하세요</p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="예: BEAR-1234"
            className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center font-mono text-lg tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />

          {error && (
            <p className="text-red-500 text-sm text-center mt-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={!key.trim() || isLoading}
            className="w-full mt-4 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '확인 중...' : '입장'}
          </button>
        </form>
      </div>
    </div>
  );
}
