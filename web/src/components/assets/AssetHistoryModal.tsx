'use client';

import { useState, useEffect } from 'react';
import { Asset, AssetHistoryEntry, ASSET_TYPE_CONFIG } from '@/types/asset';
import { subscribeToAssetHistory, updateBalanceWithHistory, deleteHistoryEntry } from '@/lib/assetService';
import Portal from '@/components/Portal';
import { X, Plus, Trash2, Edit2, TrendingUp, TrendingDown, Building2, Home } from 'lucide-react';

interface AssetHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  onEditAsset: () => void;
  onViewChart: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  bank: <Building2 className="w-5 h-5" />,
  investment: <TrendingUp className="w-5 h-5" />,
  property: <Home className="w-5 h-5" />,
};

export default function AssetHistoryModal({
  isOpen,
  onClose,
  asset,
  onEditAsset,
  onViewChart,
}: AssetHistoryModalProps) {
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [updateDate, setUpdateDate] = useState(new Date().toISOString().split('T')[0]);
  const [updateMemo, setUpdateMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 이력 구독
  useEffect(() => {
    if (!asset) return;

    const unsubscribe = subscribeToAssetHistory(asset.id, setHistory);
    return () => unsubscribe();
  }, [asset]);

  // 잔액 업데이트 폼 초기화
  useEffect(() => {
    if (showUpdateForm && asset) {
      setNewBalance(asset.currentBalance.toString());
      setUpdateDate(new Date().toISOString().split('T')[0]);
      setUpdateMemo('');
    }
  }, [showUpdateForm, asset]);

  const handleUpdateBalance = async () => {
    if (!asset || isSubmitting) return;

    const balanceNum = parseInt(newBalance, 10);
    if (isNaN(balanceNum)) return;

    setIsSubmitting(true);
    try {
      await updateBalanceWithHistory(asset.id, balanceNum, updateDate, updateMemo.trim());
      setShowUpdateForm(false);
    } catch (error) {
      console.error('잔액 업데이트 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHistory = async (historyId: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await deleteHistoryEntry(historyId);
    } catch (error) {
      console.error('이력 삭제 오류:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !asset) return null;

  const config = ASSET_TYPE_CONFIG[asset.type];

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-2xl m-4 max-w-lg w-full shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* 헤더 */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${asset.color || config.color}15`, color: asset.color || config.color }}
                >
                  {ICONS[asset.type]}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{asset.name}</h3>
                  <p className="text-sm text-slate-500">
                    {asset.subType && `${asset.subType} · `}
                    {asset.currentBalance.toLocaleString()}원
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={onEditAsset}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                  title="수정"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            {/* 잔액 업데이트 버튼 */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowUpdateForm(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                잔액 업데이트
              </button>
              <button
                onClick={onViewChart}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
              >
                차트
              </button>
            </div>
          </div>

          {/* 잔액 업데이트 폼 */}
          {showUpdateForm && (
            <div className="p-4 bg-blue-50 border-b border-blue-100">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    새 잔액
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newBalance ? parseInt(newBalance, 10).toLocaleString() : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setNewBalance(raw);
                      }}
                      className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      원
                    </span>
                  </div>
                  {newBalance && asset && (
                    <p
                      className={`text-sm mt-1 ${
                        parseInt(newBalance, 10) > asset.currentBalance
                          ? 'text-green-500'
                          : parseInt(newBalance, 10) < asset.currentBalance
                          ? 'text-red-500'
                          : 'text-slate-400'
                      }`}
                    >
                      {parseInt(newBalance, 10) > asset.currentBalance
                        ? `+${(parseInt(newBalance, 10) - asset.currentBalance).toLocaleString()}`
                        : parseInt(newBalance, 10) < asset.currentBalance
                        ? (parseInt(newBalance, 10) - asset.currentBalance).toLocaleString()
                        : '변동 없음'}
                      원
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      날짜
                    </label>
                    <input
                      type="date"
                      value={updateDate}
                      onChange={(e) => setUpdateDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      메모
                    </label>
                    <input
                      type="text"
                      value={updateMemo}
                      onChange={(e) => setUpdateMemo(e.target.value)}
                      placeholder="메모 (선택)"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowUpdateForm(false)}
                    className="flex-1 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleUpdateBalance}
                    disabled={!newBalance || isSubmitting}
                    className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300"
                  >
                    {isSubmitting ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 이력 목록 */}
          <div className="flex-1 overflow-y-auto p-4">
            <h4 className="text-sm font-medium text-slate-500 mb-3">변동 이력</h4>
            {history.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                아직 이력이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl"
                  >
                    {/* 변동 아이콘 */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        entry.changeAmount > 0
                          ? 'bg-green-100 text-green-500'
                          : entry.changeAmount < 0
                          ? 'bg-red-100 text-red-500'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {entry.changeAmount > 0 ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : entry.changeAmount < 0 ? (
                        <TrendingDown className="w-4 h-4" />
                      ) : (
                        <span className="text-xs">-</span>
                      )}
                    </div>

                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">
                          {entry.balance.toLocaleString()}원
                        </span>
                        <span
                          className={`text-sm ${
                            entry.changeAmount > 0
                              ? 'text-green-500'
                              : entry.changeAmount < 0
                              ? 'text-red-500'
                              : 'text-slate-400'
                          }`}
                        >
                          ({entry.changeAmount > 0 ? '+' : ''}
                          {entry.changeAmount.toLocaleString()})
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {entry.date}
                        {entry.memo && ` · ${entry.memo}`}
                      </div>
                    </div>

                    {/* 삭제 버튼 */}
                    <button
                      onClick={() => handleDeleteHistory(entry.id)}
                      className="p-1.5 hover:bg-red-100 rounded-lg transition-colors text-slate-400 hover:text-red-500"
                      disabled={isSubmitting}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
