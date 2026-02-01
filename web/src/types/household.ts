export interface SettlementAccount {
  bankCode: string;  // 은행 코드 (예: 004)
  bankName: string;  // 은행명 (예: KB국민은행)
  accountNo: string; // 계좌번호
  accountHolder?: string; // 예금주 (선택)
}

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  defaultCategoryKey?: string; // 규칙 미매칭 시 기본 카테고리
  settlementAccount?: SettlementAccount; // 정산 계좌
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
