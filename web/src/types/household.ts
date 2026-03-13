// 가구 멤버
export interface HouseholdMember {
  id: string;       // 고유 ID (예: "m_abc123")
  name: string;     // 사용자가 입력한 이름
}

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  defaultCategoryKey?: string; // 규칙 미매칭 시 기본 카테고리
  members: HouseholdMember[]; // 가구 멤버 목록
}

// Android WebView 브리지 인터페이스
export interface AndroidBridge {
  setHouseholdKey: (key: string) => void;
  getHouseholdKey: () => string;
  clearHouseholdKey: () => void;
  setMemberName: (name: string) => void;
  setPartnerName: (name: string) => void;
}

export interface WindowWithBridge extends Window {
  AndroidBridge?: AndroidBridge;
}
