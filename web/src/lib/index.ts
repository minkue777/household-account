// ============================================
// 가계부 서비스 모듈
// ============================================

// --- 핵심 도메인 ---
export * from './expenseService';        // 지출 CRUD, 검색, 구독
export * from './partnerNotificationService'; // 파트너 알림 전송
export * from './categoryService';       // 카테고리 관리, 예산

// --- 자산 관리 ---
export * from './assetService';          // 자산, 주식, 배당금

// --- 자동화 ---
export * from './merchantRuleService';   // 가맹점 자동분류 규칙
export * from './recurringExpenseService'; // 정기 지출

// --- 외부 연동 ---
export * from './householdService';      // 가구 관리, 초대코드
export * from './authService';           // Google 인증
export * from './pushNotificationService'; // FCM 알림
export * from './balanceService';        // 지역화폐 잔액
