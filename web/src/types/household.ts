export interface SettlementAccount {
  bankCode: string;  // 은행 코드 (예: 004)
  bankName: string;  // 은행명 (예: KB국민은행)
  accountNo: string; // 계좌번호
  accountHolder?: string; // 예금주 (선택)
}

// 개인 계좌 (정산 받을 계좌)
export interface PersonalAccount {
  id: string;        // 고유 ID
  name: string;      // 이름 (예: "또니", "망고")
  bankCode: string;  // 은행 코드
  bankName: string;  // 은행명
  accountNo: string; // 계좌번호
  isDefault?: boolean; // 기본 계좌 여부
}

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  defaultCategoryKey?: string; // 규칙 미매칭 시 기본 카테고리
  settlementAccount?: SettlementAccount; // (deprecated) 기존 정산 계좌
  personalAccounts?: PersonalAccount[]; // 개인 계좌 목록
}

// Android WebView 브리지 인터페이스
export interface AndroidBridge {
  setHouseholdKey: (key: string) => void;
  getHouseholdKey: () => string;
  clearHouseholdKey: () => void;
}

export interface WindowWithBridge extends Window {
  AndroidBridge?: AndroidBridge;
}
