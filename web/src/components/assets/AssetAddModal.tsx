'use client';

import { useState, useEffect } from 'react';
import { AssetType, AssetInput, ASSET_TYPE_CONFIG } from '@/types/asset';
import { addAsset } from '@/lib/assetService';
import Portal from '@/components/Portal';
import { X, Building2, TrendingUp, Home } from 'lucide-react';

interface AssetAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: AssetType;
}

const ICONS: Record<AssetType, React.ReactNode> = {
  bank: <Building2 className="w-5 h-5" />,
  investment: <TrendingUp className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
};

export default function AssetAddModal({ isOpen, onClose, defaultType = 'bank' }: AssetAddModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>(defaultType);
  const [subType, setSubType] = useState('');
  const [balance, setBalance] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 타입 변경시 하위 타입 초기화
  useEffect(() => {
    setSubType(ASSET_TYPE_CONFIG[type].subTypes[0] || '');
  }, [type]);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setName('');
      setType(defaultType);
      setSubType(ASSET_TYPE_CONFIG[defaultType].subTypes[0] || '');
      setBalance('');
      setMemo('');
    }
  }, [isOpen, defaultType]);

  const handleSubmit = async () => {
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const input: AssetInput = {
        name: name.trim(),
        type,
        subType: subType || undefined,
        currentBalance: parseInt(balance, 10) || 0,
        currency: 'KRW',
        memo: memo.trim() || undefined,
        isActive: true,
        order: Date.now(), // 추가 순서
      };

      await addAsset(input);
      onClose();
    } catch (error) {
      console.error('자산 추가 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800">자산 추가</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="space-y-4">
            {/* 자산 타입 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">유형</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((t) => {
                  const config = ASSET_TYPE_CONFIG[t];
                  const isSelected = type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span style={{ color: isSelected ? config.color : '#64748b' }}>
                        {ICONS[t]}
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          isSelected ? 'text-blue-600' : 'text-slate-600'
                        }`}
                      >
                        {config.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 하위 유형 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                세부 유형
              </label>
              <div className="flex flex-wrap gap-2">
                {ASSET_TYPE_CONFIG[type].subTypes.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSubType(st)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      subType === st
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* 자산명 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                자산명
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`예: KB은행 ${subType || '예금'}`}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 현재 잔액 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                현재 잔액
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={balance ? parseInt(balance, 10).toLocaleString() : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setBalance(raw);
                  }}
                  placeholder="0"
                  className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  원
                </span>
              </div>
            </div>

            {/* 메모 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="메모 입력"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 버튼 */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || isSubmitting}
              className="flex-1 py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '추가 중...' : '추가'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
