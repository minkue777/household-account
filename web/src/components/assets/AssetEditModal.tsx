'use client';

import { useEffect, useState } from 'react';
import {
  Asset,
  AssetType,
  ASSET_TYPE_CONFIG,
  LoanRepaymentMethod,
  isGoldEtfSubType,
  normalizeGoldSubType,
} from '@/types/asset';
import { deleteAsset, updateAsset } from '@/lib/assetService';
import { ConfirmDialog, ModalOverlay } from '@/components/common';
import { X, Trash2 } from 'lucide-react';
import {
  AssetMemoField,
  AssetTypeGrid,
  LoanRepaymentFields,
  SavingsRecurringFields,
  StockInitialInvestmentField,
} from './AssetFormFields';

interface AssetEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

function sanitizeGoldQuantity(rawValue: string) {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');

  if (firstDot === -1) {
    return cleaned;
  }

  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, '')}`;
}

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getEffectiveContributionDay(dayOfMonth: number) {
  const now = new Date();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.min(dayOfMonth, lastDayOfMonth);
}

export default function AssetEditModal({ isOpen, onClose, asset }: AssetEditModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AssetType>('savings');
  const [subType, setSubType] = useState('');
  const [balance, setBalance] = useState('');
  const [recurringContributionAmount, setRecurringContributionAmount] = useState('');
  const [recurringContributionDay, setRecurringContributionDay] = useState('');
  const [loanInterestRate, setLoanInterestRate] = useState('');
  const [loanRepaymentMethod, setLoanRepaymentMethod] = useState<LoanRepaymentMethod | ''>('');
  const [loanMonthlyPaymentAmount, setLoanMonthlyPaymentAmount] = useState('');
  const [loanPaymentDay, setLoanPaymentDay] = useState('');
  const [initialInvestment, setInitialInvestment] = useState('');
  const [memo, setMemo] = useState('');
  const [goldQuantity, setGoldQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!asset) {
      return;
    }

    const goldQuantityMatch = asset.memo?.match(/(\d+(?:\.\d+)?)\s*돈/);
    const resolvedSubType =
      asset.type === 'gold'
        ? normalizeGoldSubType(asset.subType) || ASSET_TYPE_CONFIG[asset.type].subTypes[0] || ''
        : asset.subType || ASSET_TYPE_CONFIG[asset.type].subTypes[0] || '';

    setName(asset.name);
    setType(asset.type);
    setSubType(resolvedSubType);
    setBalance(Math.abs(asset.currentBalance || 0).toString());
    setRecurringContributionAmount(
      asset.recurringContributionAmount ? asset.recurringContributionAmount.toString() : ''
    );
    setRecurringContributionDay(
      asset.recurringContributionDay ? asset.recurringContributionDay.toString() : ''
    );
    setLoanInterestRate(
      asset.loanInterestRate ? asset.loanInterestRate.toString() : ''
    );
    setLoanRepaymentMethod(asset.loanRepaymentMethod || '');
    setLoanMonthlyPaymentAmount(
      asset.loanMonthlyPaymentAmount ? asset.loanMonthlyPaymentAmount.toString() : ''
    );
    setLoanPaymentDay(asset.loanPaymentDay ? asset.loanPaymentDay.toString() : '');
    setInitialInvestment(asset.initialInvestment?.toString() || '');
    setMemo(asset.type === 'gold' && !isGoldEtfSubType(asset.subType) ? '' : asset.memo || '');
    setGoldQuantity(goldQuantityMatch ? goldQuantityMatch[1] : '');
    setShowDeleteConfirm(false);
  }, [asset]);

  useEffect(() => {
    if (!ASSET_TYPE_CONFIG[type].subTypes.includes(subType)) {
      setSubType(ASSET_TYPE_CONFIG[type].subTypes[0] || '');
    }
  }, [subType, type]);

  useEffect(() => {
    if (type !== 'gold') {
      setGoldQuantity('');
    }
  }, [type]);

  const handleSubmit = async () => {
    if (!asset || !name.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const recurringAmount = parseInt(recurringContributionAmount, 10) || 0;
      const rawRecurringDay = parseInt(recurringContributionDay, 10) || 0;
      const recurringDay = rawRecurringDay >= 1 && rawRecurringDay <= 31 ? rawRecurringDay : 0;
      const isSavingsInstallment = type === 'savings' && subType === '적금';
      const rawLoanPaymentDay = parseInt(loanPaymentDay, 10) || 0;
      const normalizedLoanPaymentDay =
        rawLoanPaymentDay >= 1 && rawLoanPaymentDay <= 31 ? rawLoanPaymentDay : 0;
      const isLoanAsset = type === 'loan';
      const isScheduledLoan =
        isLoanAsset &&
        (loanRepaymentMethod === '원리금균등상환' || loanRepaymentMethod === '원금균등상환');

      const updateData: Record<string, unknown> = {
        name: name.trim(),
        type,
        subType: subType || '',
        recurringContributionAmount: isSavingsInstallment ? recurringAmount : 0,
        recurringContributionDay: isSavingsInstallment ? recurringDay : 0,
        lastAutoContributionMonth: !isSavingsInstallment
          ? ''
          : asset.lastAutoContributionMonth === getCurrentYearMonth()
            ? asset.lastAutoContributionMonth
            : recurringAmount > 0 &&
                recurringDay > 0 &&
                new Date().getDate() >= getEffectiveContributionDay(recurringDay)
              ? getCurrentYearMonth()
              : asset.lastAutoContributionMonth || '',
        loanInterestRate: isLoanAsset ? parseFloat(loanInterestRate) || 0 : 0,
        loanRepaymentMethod: isLoanAsset ? loanRepaymentMethod || '' : '',
        loanMonthlyPaymentAmount: isScheduledLoan ? parseInt(loanMonthlyPaymentAmount, 10) || 0 : 0,
        loanPaymentDay: isScheduledLoan ? normalizedLoanPaymentDay : 0,
        lastAutoRepaymentMonth:
          !isScheduledLoan
            ? ''
            : asset.lastAutoRepaymentMonth === getCurrentYearMonth()
              ? asset.lastAutoRepaymentMonth
              : (parseFloat(loanInterestRate) || 0) > 0 &&
                  (parseInt(loanMonthlyPaymentAmount, 10) || 0) > 0 &&
                  normalizedLoanPaymentDay > 0 &&
                  new Date().getDate() >= getEffectiveContributionDay(normalizedLoanPaymentDay)
                ? getCurrentYearMonth()
                : asset.lastAutoRepaymentMonth || '',
      };

      if (type === 'stock') {
        updateData.initialInvestment = initialInvestment ? parseInt(initialInvestment, 10) : 0;
        updateData.memo = memo.trim();
      } else if (type === 'crypto') {
        updateData.memo = memo.trim();
      } else if (type === 'gold' && isGoldEtfSubType(subType)) {
        updateData.memo = memo.trim();
      } else {
        updateData.currentBalance = parseInt(balance, 10) || 0;
        updateData.memo = type === 'gold' ? (goldQuantity ? `${goldQuantity}돈` : '') : memo.trim();
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

  const isStock = type === 'stock';
  const isCrypto = type === 'crypto';
  const isGold = type === 'gold';
  const isGoldEtf = isGold && isGoldEtfSubType(subType);
  const isPhysicalGold = isGold && !isGoldEtf;
  const isHoldingManaged = isStock || isCrypto || isGoldEtf;
  const isSavingsInstallment = type === 'savings' && subType === '적금';
  const isLoanAsset = type === 'loan';

  return (
    <>
      <ModalOverlay onClose={onClose}>
        <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-h-[90vh]">
          <div className="flex shrink-0 items-center justify-between px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
            <h2 className="text-xl font-bold text-slate-800">자산 수정</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
              >
                <Trash2 className="h-5 w-5" />
              </button>
              <button
                onClick={onClose}
                className="rounded-lg p-2 transition-colors hover:bg-slate-100"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">유형</label>
              <AssetTypeGrid
                value={type}
                onChange={setType}
                itemLabelClassName="text-[11px] sm:text-sm font-medium"
              />
            </div>

            {ASSET_TYPE_CONFIG[type].subTypes.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">세부 유형</label>
                <div className="flex flex-wrap gap-2">
                  {ASSET_TYPE_CONFIG[type].subTypes.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSubType(option)}
                      className={`rounded-full px-3 py-1.5 text-sm transition-all ${
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
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">자산명</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {!isHoldingManaged && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">현재 잔액</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={balance ? parseInt(balance, 10).toLocaleString() : ''}
                    onChange={(e) => setBalance(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
                </div>
              </div>
            )}

            {isSavingsInstallment && (
              <SavingsRecurringFields
                amountValue={recurringContributionAmount}
                dayValue={recurringContributionDay}
                onAmountChange={setRecurringContributionAmount}
                onDayChange={setRecurringContributionDay}
              />
            )}

            {isLoanAsset && (
              <LoanRepaymentFields
                balanceValue={balance}
                interestRateValue={loanInterestRate}
                repaymentMethodValue={loanRepaymentMethod}
                monthlyPaymentValue={loanMonthlyPaymentAmount}
                paymentDayValue={loanPaymentDay}
                onInterestRateChange={setLoanInterestRate}
                onRepaymentMethodChange={setLoanRepaymentMethod}
                onMonthlyPaymentChange={setLoanMonthlyPaymentAmount}
                onPaymentDayChange={setLoanPaymentDay}
              />
            )}

            {isPhysicalGold && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">보유량</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={goldQuantity}
                    onChange={(e) => setGoldQuantity(sanitizeGoldQuantity(e.target.value))}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">돈</span>
                </div>
              </div>
            )}

            {isStock && (
              <StockInitialInvestmentField
                value={initialInvestment}
                onChange={setInitialInvestment}
              />
            )}

            {!isPhysicalGold && (
              <AssetMemoField
                value={memo}
                onChange={setMemo}
              />
            )}
            </div>
          </div>

          <div className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-50"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || isSubmitting}
              className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
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
