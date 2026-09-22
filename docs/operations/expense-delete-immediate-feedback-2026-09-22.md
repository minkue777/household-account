# 지출 수정·삭제의 즉시 화면 반영 통일

## 원인과 요구사항

2026-09-22 운영 로그에서 11:45 KST 삭제 두 건은 서버 실행 369ms·343ms에 성공했습니다. 화면은 `expenseService.deleteExpense`의 낙관적 삭제를 즉시 받지만, `ExpenseEditModal`은 서버 응답 뒤에만 닫혀 통신과 서버 처리 시간이 그대로 보였습니다. 9월 17일 편집 인스턴스 보존 변경 이후 마지막 거래가 목록에서 없어져도 편집창이 유지됩니다. 메모·카테고리 저장에는 이미 pending 동안 창을 숨기는 처리가 있습니다.

LED-005 / T-LED-008에 따라 수정과 삭제의 화면 피드백을 통일합니다. 삭제 확인 전에는 요청하지 않고, 확인 직후 서버 응답을 기다리지 않고 편집창과 확인창을 숨깁니다. pending 동안 초안을 보존하며 성공 시 부모 선택을 정리하고 실패 시 기존 낙관적 목록 원복과 오류 안내 확인 뒤 초안 복구를 유지합니다. 날짜·가구·페이지·편집 대상이 바뀐 뒤 이전 응답은 새 화면에 간섭하지 않습니다.

## 설계·계약

- 수정과 삭제가 같은 편집창 pending 상태를 사용합니다. 중복 제출은 기존 ref로 차단합니다.
- `onDelete` Promise를 계속 기다리며 서버 성공으로 위장하지 않습니다. 기존 `deleteExpense`가 확정과 rollback을 담당합니다.
- 삭제 실패도 수정과 같은 `isOpenRef` 경계를 확인합니다. 이미 종료한 편집의 늦은 오류로 다른 창을 가리지 않습니다.
- 서버의 `ledger.delete-transaction.v1`, expectedVersion, 논리 삭제, receipt·Outbox 계약은 유지합니다. 운영 금융 데이터는 검증용으로 수정하지 않습니다.

## 테스트 추적성

| 요구사항 | 검증 | 검사 위치 |
|---|---|---|
| LED-005 / T-LED-008 | 수정·삭제의 서버 응답 전 편집창 숨김, 중복 삭제 차단, 실패 안내 확인 후 초안·기억 선택 복구, 다른 편집을 연 뒤 이전 성공·실패 무간섭 | `expenseEditSavePipeline.contract.test.tsx` |
| LED-001·005 / T-LED-008 | 마지막 거래가 낙관적으로 제거돼도 창을 즉시 숨기고 원복 후 초안·version 유지 | `ledgerEditDraftPersistence.contract.test.tsx` |
| LED-005·STAT-004 / T-LED-008 | 통계에서 수정·삭제 모두 즉시 편집창 숨김, 실패 후 기간·초안 유지, 서버 성공 때만 통계 갱신 | `statisticsPage.test.tsx` |
| LED-005 / T-LED-008 | 삭제 요청 시작 시 목록에서 제외, 서버 거절 시 항목·금액·태그 원복 | `ledgerExpenseServiceOptimistic.contract.test.ts` |
| LED-005 / T-LED-008 | 실제 Emulator 삭제 요청을 보류한 상태에서 편집창·목록·월 합계 즉시 반영, 서버 원본 미변경 확인, 해제 후 논리 삭제 확정 또는 실제 version 충돌 뒤 원복 | `finance-ledger.spec.ts` |

## 검증·배포

수정 전 새 즉시 숨김 회귀 검사 6개가 모두 실패했고, 수정 후 관련 Web 계약 검사 5개 파일의 76개와 `tsc --noEmit`이 통과했습니다. 통계 검사의 기존 삭제 대기 기대값도 수정·삭제 공통 즉시 숨김 계약으로 바꾸고, 기존 실패 복구·재시도·캐시 갱신 검증은 유지했습니다. E2E 준비 단계의 Functions architecture 45개도 통과했습니다.

실제 브라우저·Firebase Emulator 검사와 전체 CI는 별도로 확인합니다. 브라우저 검사는 삭제 Command를 보류하고 서버 원본이 그대로인데 편집창·목록·월 합계가 바뀌는지 검사합니다. 실패 검사는 다른 클라이언트의 실제 수정으로 expectedVersion 충돌을 만들며 가짜 성공·실패 응답을 주입하지 않습니다. 실행 코드 변경은 Web 편집창뿐이며 Vercel Git 자동배포 대상입니다. Firebase와 Android APK는 재배포하지 않습니다.
