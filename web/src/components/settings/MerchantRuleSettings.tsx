'use client';

import { useState, useEffect, useRef } from 'react';
import { useCategoryContext } from '@/contexts/CategoryContext';
import {
  MerchantRule,
  MatchType,
  subscribeToRules,
  updateMerchantRuleV2,
  deleteMerchantRule,
  addMerchantRuleV2,
  MATCH_TYPE_LABELS,
} from '@/lib/merchantRuleService';
import { getStoredHouseholdKey } from '@/lib/householdService';
import { ConfirmDialog } from '@/components/common';
import { Building2, ChevronDown, Edit2, Plus, Trash2 } from 'lucide-react';

export default function MerchantRuleSettings() {
  const {
    activeCategories,
    getCategoryLabel,
    getCategoryColor,
  } = useCategoryContext();

  // 섹션 펼침/접힘 상태
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  // 가맹점 규칙 상태
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [showAddRuleForm, setShowAddRuleForm] = useState(false);
  const [pendingDeleteRule, setPendingDeleteRule] = useState<MerchantRule | null>(null);
  const ruleFormRef = useRef<HTMLDivElement>(null);

  // 규칙 폼 상태 (추가/편집 공용)
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleMatchType, setRuleMatchType] = useState<MatchType>('contains');
  const [ruleMappedMerchant, setRuleMappedMerchant] = useState('');
  const [ruleCategory, setRuleCategory] = useState('');
  const [ruleMemo, setRuleMemo] = useState('');

  // 가맹점 규칙 구독
  useEffect(() => {
    const householdId = getStoredHouseholdKey() || 'guest';

    const unsubscribeRules = subscribeToRules(householdId, (rules) => {
      setMerchantRules(rules);
      setRulesLoading(false);
    });

    return () => {
      unsubscribeRules();
    };
  }, []);

  // 가맹점 규칙 핸들러
  const resetRuleForm = () => {
    setRuleKeyword('');
    setRuleMatchType('contains');
    setRuleMappedMerchant('');
    setRuleCategory('');
    setRuleMemo('');
    setEditingRuleId(null);
    setShowAddRuleForm(false);
  };

  const handleStartEditRule = (rule: MerchantRule) => {
    setEditingRuleId(rule.id);
    setRuleKeyword(rule.merchantKeyword);
    setRuleMatchType(rule.matchType || (rule.exactMatch ? 'exact' : 'contains'));
    setRuleMappedMerchant(rule.mapping?.merchant || '');
    setRuleCategory(rule.mapping?.category || rule.category || '');
    setRuleMemo(rule.mapping?.memo || '');
    setShowAddRuleForm(false);
    // 폼으로 스크롤
    setTimeout(() => {
      ruleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleSaveRule = async () => {
    if (!ruleKeyword.trim() || !ruleCategory) return;

    const householdId = getStoredHouseholdKey() || 'guest';
    const mapping = {
      ...(ruleMappedMerchant.trim() && { merchant: ruleMappedMerchant.trim() }),
      category: ruleCategory,
      ...(ruleMemo.trim() && { memo: ruleMemo.trim() }),
    };

    if (editingRuleId) {
      // 편집
      await updateMerchantRuleV2(editingRuleId, {
        merchantKeyword: ruleKeyword.trim(),
        matchType: ruleMatchType,
        mapping,
      });
    } else {
      // 추가
      await addMerchantRuleV2(householdId, {
        merchantKeyword: ruleKeyword.trim(),
        matchType: ruleMatchType,
        mapping,
      });
    }

    resetRuleForm();
  };

  const handleDeleteRule = async () => {
    if (!pendingDeleteRule) return;

    await deleteMerchantRule(pendingDeleteRule.id);
    setPendingDeleteRule(null);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsRulesOpen(!isRulesOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-green-600" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">가맹점 규칙</div>
            <div className="text-sm text-slate-500">
              {rulesLoading ? '로딩중...' : `${merchantRules.length}개`}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-slate-400 transition-transform ${isRulesOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isRulesOpen && (
        <div className="border-t border-slate-100">
          {/* 규칙 추가/편집 폼 */}
          {(showAddRuleForm || editingRuleId) && (
            <div ref={ruleFormRef} className="scroll-mt-24 p-4 bg-slate-50 border-b border-slate-200">
              <div className="space-y-4">
                <div className="font-medium text-slate-800">
                  {editingRuleId ? '규칙 편집' : '새 규칙 추가'}
                </div>

                {/* 매칭 키워드 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    매칭 키워드
                  </label>
                  <input
                    type="text"
                    value={ruleKeyword}
                    onChange={(e) => setRuleKeyword(e.target.value)}
                    placeholder="예: 스타벅스, 효성에프엠에스"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 매칭 타입 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    매칭 방식
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['contains', 'exact', 'startsWith', 'endsWith'] as MatchType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setRuleMatchType(type)}
                        className={`py-2 px-3 text-sm rounded-lg border-2 transition-colors ${
                          ruleMatchType === type
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {MATCH_TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {ruleMatchType === 'contains' && '가맹점명에 키워드가 포함되면 매칭'}
                    {ruleMatchType === 'exact' && '가맹점명이 키워드와 정확히 일치하면 매칭'}
                    {ruleMatchType === 'startsWith' && '가맹점명이 키워드로 시작하면 매칭'}
                    {ruleMatchType === 'endsWith' && '가맹점명이 키워드로 끝나면 매칭'}
                    <span className="block mt-1 text-slate-400">쉼표로 구분하면 OR 조건 (예: 약국, 병원, 의원)</span>
                  </p>
                </div>

                {/* 매핑할 가맹점명 (선택) */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    표시할 가맹점명 <span className="text-slate-400">(선택)</span>
                  </label>
                  <input
                    type="text"
                    value={ruleMappedMerchant}
                    onChange={(e) => setRuleMappedMerchant(e.target.value)}
                    placeholder="비워두면 원본 가맹점명 유지"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 카테고리 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    카테고리
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {activeCategories.map((cat) => (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setRuleCategory(cat.key)}
                        className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors ${
                          ruleCategory === cat.key
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-full mb-1"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-xs text-slate-700">
                          {cat.label.slice(0, 3)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 메모 (선택) */}
                <div>
                  <label className="block text-sm text-slate-600 mb-1">
                    메모 <span className="text-slate-400">(선택)</span>
                  </label>
                  <input
                    type="text"
                    value={ruleMemo}
                    onChange={(e) => setRuleMemo(e.target.value)}
                    placeholder="자동으로 추가될 메모"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 버튼 */}
                <div className="flex gap-2">
                  <button
                    onClick={resetRuleForm}
                    className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSaveRule}
                    disabled={!ruleKeyword.trim() || !ruleCategory}
                    className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editingRuleId ? '저장' : '추가'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {rulesLoading ? (
            <div className="p-8 text-center text-slate-400">로딩중...</div>
          ) : merchantRules.length === 0 && !showAddRuleForm ? (
            <div className="p-8 text-center text-slate-400">
              저장된 가맹점 규칙이 없습니다.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {merchantRules.map((rule) => (
                <div key={rule.id} className={`p-4 ${editingRuleId === rule.id ? 'hidden' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0"
                        style={{ backgroundColor: getCategoryColor(rule.mapping?.category || rule.category || 'etc') }}
                      >
                        {getCategoryLabel(rule.mapping?.category || rule.category || 'etc').slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 flex-shrink-0">
                            {MATCH_TYPE_LABELS[rule.matchType] || '포함'}
                          </span>
                          <span className="truncate">{rule.merchantKeyword}</span>
                        </div>
                        <div className="text-sm text-slate-500 truncate">
                          → {rule.mapping?.merchant ? (
                            <span className="text-green-600">{rule.mapping.merchant}</span>
                          ) : (
                            <span className="text-slate-400">원본 유지</span>
                          )}
                          {' · '}
                          {getCategoryLabel(rule.mapping?.category || rule.category || 'etc')}
                          {rule.mapping?.memo && (
                            <span className="text-slate-400"> · 메모: {rule.mapping.memo}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleStartEditRule(rule)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label={`${rule.merchantKeyword} 규칙 수정`}
                        title="수정"
                      >
                        <Edit2 className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setPendingDeleteRule(rule)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label={`${rule.merchantKeyword} 규칙 삭제`}
                        title="삭제"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 추가 버튼 */}
          {!showAddRuleForm && !editingRuleId && (
            <button
              onClick={() => setShowAddRuleForm(true)}
              className="w-full p-4 border-t border-slate-200 flex items-center justify-center gap-2 text-green-600 hover:bg-green-50 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span className="font-medium">새 규칙 추가</span>
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingDeleteRule}
        title="가맹점 규칙 삭제"
        message={
          pendingDeleteRule
            ? `"${pendingDeleteRule.merchantKeyword}" 규칙을 삭제하시겠습니까?`
            : ''
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => {
          void handleDeleteRule();
        }}
        onCancel={() => setPendingDeleteRule(null)}
      />
    </div>
  );
}
