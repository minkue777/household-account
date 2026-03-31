'use client';

import type { GoldPriceData } from '@/lib/utils/useGoldHolding';
import { calculateExpectedLoanPrincipalPayment } from '@/lib/assets/assetMath';
import {
  AssetType,
  ASSET_TYPE_CONFIG,
  LOAN_REPAYMENT_METHODS,
  LoanRepaymentMethod,
} from '@/types/asset';
import { ASSET_TYPE_ICON_COMPONENTS } from './assetIcons';

interface AssetTypeGridProps {
  value: AssetType;
  onChange: (type: AssetType) => void;
  itemLabelClassName?: string;
}

export function AssetTypeGrid({
  value,
  onChange,
  itemLabelClassName = 'text-[10px] sm:text-xs font-medium',
}: AssetTypeGridProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2">
      {(Object.keys(ASSET_TYPE_CONFIG) as AssetType[]).map((type) => {
        const config = ASSET_TYPE_CONFIG[type];
        const isSelected = value === type;
        const Icon = ASSET_TYPE_ICON_COMPONENTS[type];

        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1.5 py-2 transition-all sm:min-h-[84px] sm:gap-1.5 sm:px-2.5 sm:py-3 ${
              isSelected
                ? 'bg-white'
                : 'border-slate-200 hover:border-slate-300'
            }`}
            style={
              isSelected
                ? {
                    borderColor: config.color,
                    backgroundColor: `${config.color}12`,
                  }
                : undefined
            }
          >
            <span style={{ color: isSelected ? config.color : '#64748b' }}>
              <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
            </span>
            <span
              className={`whitespace-nowrap leading-none tracking-[-0.01em] ${itemLabelClassName}`}
              style={{ color: isSelected ? config.color : '#475569' }}
            >
              {config.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface StockInitialInvestmentFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function StockInitialInvestmentField({ value, onChange }: StockInitialInvestmentFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        투자원금
        <span className="text-xs text-slate-400 ml-2">(선택)</span>
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={value ? parseInt(value, 10).toLocaleString() : ''}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="0"
          className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
      </div>
      <p className="text-xs text-slate-500 mt-1">계좌 전체 수익률을 계산할 때 사용합니다.</p>
    </div>
  );
}

interface SavingsRecurringFieldsProps {
  amountValue: string;
  dayValue: string;
  onAmountChange: (value: string) => void;
  onDayChange: (value: string) => void;
}

export function SavingsRecurringFields({
  amountValue,
  dayValue,
  onAmountChange,
  onDayChange,
}: SavingsRecurringFieldsProps) {
  return (
    <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          월 납입금
          <span className="text-xs text-slate-400 ml-2">(선택)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            value={amountValue ? parseInt(amountValue, 10).toLocaleString() : ''}
            onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          납입일
          <span className="text-xs text-slate-400 ml-2">(선택)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            value={dayValue}
            onChange={(e) => onDayChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            placeholder="예: 25"
            className="w-full px-4 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">일</span>
        </div>
      </div>
    </div>
  );
}

interface LoanRepaymentFieldsProps {
  balanceValue: string;
  interestRateValue: string;
  repaymentMethodValue: LoanRepaymentMethod | '';
  monthlyPaymentValue: string;
  paymentDayValue: string;
  onInterestRateChange: (value: string) => void;
  onRepaymentMethodChange: (value: LoanRepaymentMethod) => void;
  onMonthlyPaymentChange: (value: string) => void;
  onPaymentDayChange: (value: string) => void;
}

export function LoanRepaymentFields({
  balanceValue,
  interestRateValue,
  repaymentMethodValue,
  monthlyPaymentValue,
  paymentDayValue,
  onInterestRateChange,
  onRepaymentMethodChange,
  onMonthlyPaymentChange,
  onPaymentDayChange,
}: LoanRepaymentFieldsProps) {
  const parsedBalance = parseInt(balanceValue, 10) || 0;
  const parsedInterestRate = parseFloat(interestRateValue) || 0;
  const parsedMonthlyPayment = parseInt(monthlyPaymentValue, 10) || 0;
  const isScheduledLoan =
    repaymentMethodValue === '원리금균등상환' || repaymentMethodValue === '원금균등상환';
  const isAmortizedLoan = repaymentMethodValue === '원리금균등상환';
  const isPrincipalEqualLoan = repaymentMethodValue === '원금균등상환';
  const predictedPrincipalPayment = calculateExpectedLoanPrincipalPayment({
    type: 'loan',
    currentBalance: parsedBalance,
    loanInterestRate: parsedInterestRate,
    loanMonthlyPaymentAmount: parsedMonthlyPayment,
    loanRepaymentMethod: repaymentMethodValue || undefined,
  });

  return (
    <div className="space-y-3 rounded-xl border border-red-100 bg-red-50/70 p-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          금리
          <span className="ml-2 text-xs text-slate-400">(선택)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            value={interestRateValue}
            onChange={(e) =>
              onInterestRateChange(
                e.target.value
                  .replace(/[^0-9.]/g, '')
                  .replace(/(\..*)\./g, '$1')
              )
            }
            placeholder="예: 3.8"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">상환방식</label>
        <div className="flex flex-wrap gap-2">
          {LOAN_REPAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onRepaymentMethodChange(method)}
              className={`rounded-full px-3 py-1.5 text-sm transition-all ${
                repaymentMethodValue === method
                  ? 'bg-red-500 text-white'
                  : 'bg-white text-slate-600 hover:bg-red-100'
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      {isScheduledLoan && (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {isAmortizedLoan ? '매달 내는 원리금' : '매달 상환 원금'}
              <span className="ml-2 text-xs text-slate-400">(선택)</span>
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={monthlyPaymentValue ? parseInt(monthlyPaymentValue, 10).toLocaleString() : ''}
                onChange={(e) => onMonthlyPaymentChange(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              상환일
              <span className="ml-2 text-xs text-slate-400">(선택)</span>
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={paymentDayValue}
                onChange={(e) =>
                  onPaymentDayChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))
                }
                placeholder="예: 25"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">일</span>
            </div>
          </div>

          <div className="rounded-lg border border-red-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">예상 월 원금 감소액</p>
            <p className="mt-1 text-sm font-semibold text-red-500">
              {predictedPrincipalPayment.toLocaleString()}원
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {isPrincipalEqualLoan
                ? '금리가 입력된 경우에만 입력한 원금만큼 자동 상환됩니다.'
                : '금리가 입력된 경우에만 자동 상환이 적용됩니다.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

interface PhysicalGoldFieldsProps {
  quantityValue: string;
  onQuantityChange: (value: string) => void;
  goldPrice: GoldPriceData | null;
  isLoadingPrice: boolean;
  onRefreshPrice: () => void;
}

export function PhysicalGoldFields({
  quantityValue,
  onQuantityChange,
  goldPrice,
  isLoadingPrice,
  onRefreshPrice,
}: PhysicalGoldFieldsProps) {
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/85 p-4 shadow-sm shadow-amber-100/45">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700">현재 금 시세 (1돈)</label>
        <button
          type="button"
          onClick={onRefreshPrice}
          className="rounded-lg px-2 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
        >
          {isLoadingPrice ? '불러오는 중...' : '새로고침'}
        </button>
      </div>

      {goldPrice ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-amber-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">살 때</p>
            <p className="mt-1 text-sm font-semibold text-red-500">
              {goldPrice.buyPricePerDon.toLocaleString()}원
            </p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">팔 때</p>
            <p className="mt-1 text-sm font-semibold text-blue-500">
              {goldPrice.sellPricePerDon.toLocaleString()}원
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-amber-700">현재 시세를 아직 불러오지 못했습니다.</p>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">보유량</label>
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            value={quantityValue}
            onChange={(e) => onQuantityChange(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">돈</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">실제 자산 평가 금액은 팔 때 기준으로 자동 계산됩니다.</p>
      </div>
    </div>
  );
}

interface AssetMemoFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function AssetMemoField({ value, onChange }: AssetMemoFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">메모 (선택)</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="메모 입력"
        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
