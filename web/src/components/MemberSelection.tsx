'use client';

import { useState } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';

export default function MemberSelection() {
  const { household, selectMember, addMember, logout } = useHousehold();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const members = household?.members || [];
  const showForm = showAddForm || members.length === 0;

  const handleAddMember = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setIsAdding(true);
    try {
      const member = await addMember(trimmed);
      selectMember(member);
    } catch {
      alert('멤버 추가에 실패했습니다');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">👋</div>
          <h1 className="text-xl font-bold text-slate-800">
            {household?.name || '가계부'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {members.length > 0 ? '본인을 선택하세요' : '사용할 이름을 입력하세요'}
          </p>
        </div>

        {/* 기존 멤버 목록 */}
        {members.length > 0 && !showForm && (
          <div className="space-y-2 mb-4">
            {members.map((member) => (
              <button
                key={member.id}
                onClick={() => selectMember(member)}
                className="w-full py-3 px-4 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-xl text-slate-800 font-medium transition-colors text-left"
              >
                {member.name}
              </button>
            ))}
          </div>
        )}

        {/* 새 멤버 추가 폼 */}
        {showForm && (
          <div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="이름 입력"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  void handleAddMember();
                }
              }}
            />
            <button
              onClick={() => void handleAddMember()}
              disabled={!newName.trim() || isAdding}
              className="w-full mt-4 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {isAdding ? '추가 중...' : '시작하기'}
            </button>
            {members.length > 0 && (
              <button
                onClick={() => setShowAddForm(false)}
                className="w-full mt-2 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                돌아가기
              </button>
            )}
            <button
              onClick={logout}
              className="w-full mt-2 py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              가구키 다시 입력
            </button>
          </div>
        )}

        {/* 새 멤버 추가 버튼 (기존 멤버 있을 때만) */}
        {members.length > 0 && !showForm && (
          <div className="space-y-2">
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-blue-400 hover:text-blue-500 transition-colors text-sm"
            >
              + 새 멤버 추가
            </button>
            <button
              onClick={logout}
              className="w-full py-2.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              가구키 다시 입력
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
