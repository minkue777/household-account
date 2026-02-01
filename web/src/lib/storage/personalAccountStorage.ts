/**
 * 개인 계좌 로컬 스토리지 (기기별 저장)
 */

export interface LocalPersonalAccount {
  bankCode: string;
  bankName: string;
  accountNo: string;
}

const STORAGE_KEY = 'personal_account';

export const PersonalAccountStorage = {
  get(): LocalPersonalAccount | null {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  set(account: LocalPersonalAccount): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  },
};
