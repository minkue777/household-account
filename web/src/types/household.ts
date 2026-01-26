export interface Household {
  id: string;
  name: string;
  createdAt: Date;
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
