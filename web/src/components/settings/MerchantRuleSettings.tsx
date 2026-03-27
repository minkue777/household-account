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

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsRulesOpen(!isRulesOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">가맹점 규칙</div>
            <div className="text-sm text-slate-500">
              {rulesLoading ? '로딩중...' : `${merchantRules.length}개`}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${isRulesOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
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
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`"${rule.merchantKeyword}" 규칙을 삭제하시겠습니까?`)) {
                            await deleteMerchantRule(rule.id);
                          }
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
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
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium">새 규칙 추가</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
