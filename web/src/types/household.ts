export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  defaultCategoryKey?: string; // 규칙 미매칭 시 기본 카테고리
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
