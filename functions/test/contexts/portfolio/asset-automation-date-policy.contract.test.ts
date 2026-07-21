import { describe, expect, it } from 'vitest';
import { createAssetAutomationDatePolicy } from '../../../src/contexts/portfolio/automation/public';

type LoanRepaymentMethod = 'equal-principal' | 'equal-principal-and-interest' | 'bullet';

type EffectiveDateResult =
  | { kind: 'success'; effectiveDate: string }
  | { kind: 'validation-error'; code: 'INVALID_TARGET_MONTH' | 'INVALID_PAYMENT_DAY' };

type FirstMonthResult =
  | {
      kind: 'success';
      activationMonthDisposition: 'included' | 'applicable';
      firstApplicableMonth: string;
      activationMonthExecution?: { targetMonth: string; balanceDelta: 0; reason: 'included-in-current-balance' };
    }
  | { kind: 'validation-error'; code: string };

type SavingsEvaluation =
  | { kind: 'due'; effectiveDate: string; balanceDelta: number }
  | { kind: 'not-due'; effectiveDate: string }
  | { kind: 'validation-error'; code: 'INVALID_AUTOMATION_AMOUNT' | 'INVALID_PAYMENT_DAY' | 'INVALID_TARGET_MONTH' };

type LoanPrincipalResult =
  | { kind: 'success'; principal: number; resultingBalance: number }
  | { kind: 'unsupported-method'; method: 'bullet' }
  | { kind: 'validation-error'; code: string };

/** 날짜·최초 월·납입·대출 원금의 순수 정책 계약입니다. */
export interface AssetAutomationDatePolicySubject {
  calculateEffectivePaymentDate(yearMonth: string, configuredDay: number): EffectiveDateResult;
  firstMonthForInitialActivation(input: {
    assetCreatedOn: string;
    firstActivatedOn: string;
    configuredDay: number;
  }): FirstMonthResult;
  evaluateSavings(input: {
    targetMonth: string;
    configuredDay: number;
    amount: number;
    asOfDate: string;
  }): SavingsEvaluation;
  calculateLoanPrincipal(input: {
    balance: number;
    annualInterestRate: number;
    monthlyPayment: number;
    method: LoanRepaymentMethod;
  }): LoanPrincipalResult;
}

export function createSubject(): AssetAutomationDatePolicySubject {
  return createAssetAutomationDatePolicy();
}

describe('AssetAutomation 날짜·금액 정책 공개 계약', () => {
  it.each([
    ['2025-02', 31, '2025-02-28'],
    ['2024-02', 31, '2024-02-29'],
    ['2026-04', 31, '2026-04-30'],
    ['2026-07', 31, '2026-07-31'],
  ])('[T-AUTO-001][AUTO-001] %s의 %d일 설정을 유효한 말일 %s로 보정한다', (month, day, expected) => {
    const subject = createSubject();

    expect(subject.calculateEffectivePaymentDate(month, day)).toEqual({
      kind: 'success',
      effectiveDate: expected,
    });
  });

  it('[T-AUTO-001][AUTO-001] 납입일 전에는 변경하지 않고 당일부터 정확한 금액을 due로 반환한다', () => {
    const subject = createSubject();

    expect(
      subject.evaluateSavings({
        targetMonth: '2026-03',
        configuredDay: 18,
        amount: 100_000,
        asOfDate: '2026-03-17',
      })
    ).toEqual({ kind: 'not-due', effectiveDate: '2026-03-18' });

    expect(
      subject.evaluateSavings({
        targetMonth: '2026-03',
        configuredDay: 18,
        amount: 100_000,
        asOfDate: '2026-03-18',
      })
    ).toEqual({ kind: 'due', effectiveDate: '2026-03-18', balanceDelta: 100_000 });
  });

  it('[T-AUTO-002][AUTO-002][DEC-011] 최초 활성화일이 실행일 이전·당일이면 활성화 월을 최초 적용 월로 둔다', () => {
    const subject = createSubject();

    expect(subject.firstMonthForInitialActivation({ assetCreatedOn: '2026-03-17', firstActivatedOn: '2026-03-17', configuredDay: 18 })).toEqual({
      kind: 'success',
      activationMonthDisposition: 'applicable',
      firstApplicableMonth: '2026-03',
    });
    expect(subject.firstMonthForInitialActivation({ assetCreatedOn: '2026-03-18', firstActivatedOn: '2026-03-18', configuredDay: 18 })).toEqual({
      kind: 'success',
      activationMonthDisposition: 'applicable',
      firstApplicableMonth: '2026-03',
    });
  });

  it('[T-AUTO-002][AUTO-002][DEC-011] 최초 활성화일이 실행일 이후이면 활성화 월은 delta 0으로 포함 처리하고 다음 달부터 적용한다', () => {
    const subject = createSubject();
    const expected = {
      kind: 'success' as const,
      activationMonthDisposition: 'included' as const,
      firstApplicableMonth: '2026-04',
      activationMonthExecution: {
        targetMonth: '2026-03',
        balanceDelta: 0 as const,
        reason: 'included-in-current-balance' as const,
      },
    };

    expect(subject.firstMonthForInitialActivation({ assetCreatedOn: '2026-03-19', firstActivatedOn: '2026-03-19', configuredDay: 18 })).toEqual(expected);
    expect(subject.firstMonthForInitialActivation({ assetCreatedOn: '2025-01-05', firstActivatedOn: '2026-03-19', configuredDay: 18 })).toEqual(expected);
  });

  it('[T-LOAN-001][LOAN-001] 원금균등은 월 납입액을 차감하되 잔액을 넘지 않는다', () => {
    const subject = createSubject();

    expect(
      subject.calculateLoanPrincipal({
        balance: 100_000,
        annualInterestRate: 5,
        monthlyPayment: 120_000,
        method: 'equal-principal',
      })
    ).toEqual({ kind: 'success', principal: 100_000, resultingBalance: 0 });
  });

  it('[T-LOAN-001][LOAN-001] 원리금균등은 월 이자를 원 단위 반올림한 뒤 원금분을 계산한다', () => {
    const subject = createSubject();

    // round(100,000 * 5% / 12) = 417
    expect(
      subject.calculateLoanPrincipal({
        balance: 100_000,
        annualInterestRate: 5,
        monthlyPayment: 10_000,
        method: 'equal-principal-and-interest',
      })
    ).toEqual({ kind: 'success', principal: 9_583, resultingBalance: 90_417 });
  });

  it('[T-LOAN-001][LOAN-001] 월 이자가 납입액보다 커도 원금을 음수로 만들지 않는다', () => {
    const subject = createSubject();

    expect(
      subject.calculateLoanPrincipal({
        balance: 1_000_000,
        annualInterestRate: 24,
        monthlyPayment: 10_000,
        method: 'equal-principal-and-interest',
      })
    ).toEqual({ kind: 'success', principal: 0, resultingBalance: 1_000_000 });
  });

  it('[T-LOAN-001][LOAN-002] 만기일시상환을 다른 상환 공식으로 추정하지 않는다', () => {
    const subject = createSubject();

    expect(
      subject.calculateLoanPrincipal({
        balance: 1_000_000,
        annualInterestRate: 5,
        monthlyPayment: 100_000,
        method: 'bullet',
      })
    ).toEqual({ kind: 'unsupported-method', method: 'bullet' });
  });

  it.each([0, -1, Number.NaN])(
    '[T-AUTO-001][AUTO-001] 납입액 %s을 0원으로 보정하지 않고 거부한다',
    (amount) => {
      const subject = createSubject();

      expect(
        subject.evaluateSavings({
          targetMonth: '2026-03',
          configuredDay: 18,
          amount,
          asOfDate: '2026-03-18',
        })
      ).toEqual({ kind: 'validation-error', code: 'INVALID_AUTOMATION_AMOUNT' });
    }
  );
});
