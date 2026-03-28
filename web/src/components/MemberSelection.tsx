'use client';

import { useState } from 'react';
import { Check, Edit2, X } from 'lucide-react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { HouseholdMember } from '@/types/household';

export default function MemberSelection() {
  const { household, selectMember, addMember, renameMember, logout } = useHousehold();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

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
      alert('멤버 추가에 실패했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleStartEdit = (member: HouseholdMember) => {
    setShowAddForm(false);
    setEditingMemberId(member.id);
    setEditingName(member.name);
  };

  const handleCancelEdit = () => {
    setEditingMemberId(null);
    setEditingName('');
  };

  const handleRenameMember = async (memberId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;

    setIsRenaming(true);
    try {
      await renameMember(memberId, trimmed);
      handleCancelEdit();
    } catch (error) {
      const message = error instanceof Error ? error.message : '이름 변경에 실패했습니다.';
      alert(message);
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-semibold text-blue-600">
            {household?.name?.[0] || '가'}
          </div>
          <h1 className="text-xl font-bold text-slate-800">{household?.name || '가계부'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {members.length > 0 ? '사용할 사용자를 선택해주세요' : '사용자 이름을 먼저 입력해주세요'}
          </p>
        </div>

        {members.length > 0 && !showForm && (
          <div className="mb-4 space-y-2">
            {members.map((member) => (
              <div key={member.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                {editingMemberId === member.id ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder="사용자 이름"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-left text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editingName.trim()) {
                          void handleRenameMember(member.id);
                        }
                        if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancelEdit}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
                      >
                        <X className="h-4 w-4" />
                        취소
                      </button>
                      <button
                        onClick={() => void handleRenameMember(member.id)}
                        disabled={!editingName.trim() || isRenaming}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <Check className="h-4 w-4" />
                        {isRenaming ? '저장 중...' : '저장'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => selectMember(member)}
                      className="flex-1 rounded-xl px-4 py-3 text-left font-medium text-slate-800 transition-colors hover:bg-blue-50"
                    >
                      {member.name}
                    </button>
                    <button
                      onClick={() => handleStartEdit(member)}
                      className="rounded-xl p-3 text-slate-400 transition-colors hover:bg-white hover:text-blue-500"
                      aria-label={`${member.name} 이름 수정`}
                      title="이름 수정"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="이름 입력"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="mt-4 w-full rounded-xl bg-blue-500 py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isAdding ? '추가 중...' : '시작하기'}
            </button>
            {members.length > 0 && (
              <button
                onClick={() => setShowAddForm(false)}
                className="mt-2 w-full py-2 text-sm text-slate-500 transition-colors hover:text-slate-700"
              >
                돌아가기
              </button>
            )}
            <button
              onClick={logout}
              className="mt-2 w-full py-2 text-sm text-slate-400 transition-colors hover:text-slate-600"
            >
              가구키 다시 입력
            </button>
          </div>
        )}

        {members.length > 0 && !showForm && (
          <div className="space-y-2">
            <button
              onClick={() => {
                handleCancelEdit();
                setShowAddForm(true);
              }}
              className="w-full rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-sm text-slate-500 transition-colors hover:border-blue-400 hover:text-blue-500"
            >
              + 새 멤버 추가
            </button>
            <button
              onClick={logout}
              className="w-full py-2.5 text-sm text-slate-400 transition-colors hover:text-slate-600"
            >
              가구키 다시 입력
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
