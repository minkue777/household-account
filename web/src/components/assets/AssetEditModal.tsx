'use client';

import { useState, useEffect } from 'react';
import { Asset, AssetType, ASSET_TYPE_CONFIG } from '@/types/asset';
import { updateAsset, deleteAsset } from '@/lib/assetService';
import Portal from '@/components/Portal';
import { X, Trash2, Banknote, BarChart3, Home, Coins } from 'lucide-react';

interface AssetEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

const ICONS: Record<AssetType, React.ReactNode> = {
  savings: <Banknote className="w-5 h-5" />,
  stock: <BarChart3 className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
  gold: <Coins className="w-5 h-5" />,
};

export default function AssetEditModal({ isOpen, onClose, asset }: AssetEditModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>('savings');
  const [subType, setSubType] = useState('');
  const [initialInvestment, setInitialInvestment] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 자산 정보로 초기화
  useEffect(() => {
    if (asset) {
      setName(asset.name);
      setType(asset.type);
      setSubType(asset.subType || ASSET_TYPE_CONFIG[asset.type].subTypes[0] || '');
      setInitialInvestment(asset.initialInvestment?.toString() || '');
      setMemo(asset.memo || '');
    }
  }, [asset]);

  // 타입 변경시 하위 타입 조정
  useEffect(() => {
    if (!ASSET_TYPE_CONFIG[type].subTypes.includes(subType)) {
      setSubType(ASSET_TYPE_CONFIG[type].subTypes[0] || '');
    }
  }, [type, subType]);

  const handleSubmit = async () => {
    if (!asset || !name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateAsset(asset.id, {
        name: name.trim(),
        type,
        subType: subType || '',
        memo: memo.trim(),
        ...(type === 'stock' ? { initialInvestment: initialInvestment ? parseInt(initialInvestment, 10) : undefined } : {}),
      });
      onClose();
    } catch (error) {
      console.error('자산 수정 오류:', error);
      alert('자산 수정에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!asset || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await deleteAsset(asset.id);
      onClose();
    } catch (error) {
      console.error('자산 삭제 오류:', error);
    } finally {
      setIsSubmitting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen || !asset) return null;

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800">자산 수정</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-500"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
          </div>

          {showDeleteConfirm ? (
            // 삭제 확인
            <div className="text-center py-4">
              <p className="text-slate-700 mb-4">
                &quot;{asset.name}&quot;을(를) 삭제하시겠습니까?
                <br />
                <span className="text-sm text-slate-500">
                  관련된 모든 이력도 함께 삭제됩니다.
                </span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isSubmitting}
                  className="flex-1 py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:bg-slate-300"
                >
                  {isSubmitting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {/* 자산 타입 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">유형</label>
                  <div className="grid grid-cols-4 gap-2">
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
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 현재 잔액 (읽기 전용) */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    현재 잔액
                    <span className="text-xs text-slate-400 ml-2">
                      (이력에서 수정)
                    </span>
                  </label>
                  <div className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
                    {asset.currentBalance.toLocaleString()}원
                  </div>
                </div>

                {/* 투자원금 (주식만) */}
                {type === 'stock' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      투자원금
                      <span className="text-xs text-slate-400 ml-2">(선택)</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={initialInvestment ? parseInt(initialInvestment, 10).toLocaleString() : ''}
                        onChange={(e) => setInitialInvestment(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="0"
                        className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">계좌 전체 수익률 계산에 사용됩니다</p>
                  </div>
                )}

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
                  {isSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
