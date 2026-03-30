'use client';

import { useEffect, useState } from 'react';
import { Asset, AssetType, ASSET_TYPE_CONFIG } from '@/types/asset';
import { deleteAsset, updateAsset } from '@/lib/assetService';
import { ConfirmDialog, ModalOverlay } from '@/components/common';
import { X, Trash2 } from 'lucide-react';
import { AssetMemoField, AssetTypeGrid, StockInitialInvestmentField } from './AssetFormFields';
import { getAssetSignedBalance } from '@/lib/assets/assetMath';

interface AssetEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export default function AssetEditModal({ isOpen, onClose, asset }: AssetEditModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>('savings');
  const [subType, setSubType] = useState('');
  const [initialInvestment, setInitialInvestment] = useState('');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!asset) {
      return;
    }

    setName(asset.name);
    setType(asset.type);
    setSubType(asset.subType || ASSET_TYPE_CONFIG[asset.type].subTypes[0] || '');
    setInitialInvestment(asset.initialInvestment?.toString() || '');
    setMemo(asset.memo || '');
    setShowDeleteConfirm(false);
  }, [asset]);

  useEffect(() => {
    if (!ASSET_TYPE_CONFIG[type].subTypes.includes(subType)) {
      setSubType(ASSET_TYPE_CONFIG[type].subTypes[0] || '');
    }
  }, [subType, type]);

  const handleSubmit = async () => {
    if (!asset || !name.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const updateData: Record<string, unknown> = {
        name: name.trim(),
        type,
        subType: subType || '',
        memo: memo.trim(),
      };

      if (type === 'stock') {
        updateData.initialInvestment = initialInvestment ? parseInt(initialInvestment, 10) : 0;
      }

      await updateAsset(asset.id, updateData as Partial<Asset>);
      onClose();
    } catch (error) {
      console.error('자산 수정 오류:', error);
      alert('자산 수정에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!asset || isSubmitting) {
      return;
    }

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

  if (!isOpen || !asset) {
    return null;
  }

  return (
    <>
      <ModalOverlay onClose={onClose}>
        <div className="bg-white rounded-2xl p-6 m-4 max-w-md w-full shadow-xl">
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

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">유형</label>
              <AssetTypeGrid
                value={type}
                onChange={setType}
                itemLabelClassName="text-sm font-medium"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">세부 유형</label>
              <div className="flex flex-wrap gap-2">
                {ASSET_TYPE_CONFIG[type].subTypes.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSubType(option)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                      subType === option
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">자산명</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                현재 잔액
                <span className="text-xs text-slate-400 ml-2">(이력에서 수정)</span>
              </label>
              <div className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
                {getAssetSignedBalance(asset).toLocaleString()}원
              </div>
            </div>

            {type === 'stock' && (
              <StockInitialInvestmentField
                value={initialInvestment}
                onChange={setInitialInvestment}
              />
            )}

            <AssetMemoField
              value={memo}
              onChange={setMemo}
            />
          </div>

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
              {isSubmitting ? '저장 중..' : '저장'}
            </button>
          </div>
        </div>
      </ModalOverlay>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="자산 삭제"
        message={`"${asset.name}"을(를) 삭제하시겠습니까?\n관련된 모든 이력도 함께 삭제됩니다.`}
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="danger"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
