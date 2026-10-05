# 설정 저장·조회 경계 정비 (2026-10-05)

UI-03/W9/W10. 가맹점·정기 지출·카드 등록/삭제의 미처리 Promise 실패와 규칙 중복 생성 후 초안 소실을 수정했습니다. 저장 성공 때만 닫고 실패/중복은 같은 초안을 유지합니다. 같은 화면의 중복 전송을 막으며, 가구/명의 전환 뒤 이전 저장의 완료는 새 편집을 건드리지 않습니다. 삭제 확인창은 오류와 대기 상태를 직접 표시합니다. 정기 계획 활성화도 같은 실패 처리를 사용합니다.

규칙 구독은 canonical mapping과 collectionVersion을 함께 전달합니다. meta 또는 목록 오류는 별도 실패이며 빈 성공을 발행하지 않습니다. 마지막 정상 목록을 보존하고 명시적 재구독으로 복구합니다. 해제되거나 실패한 구독의 늦은 결과는 버립니다. 더 이상 쓰지 않는 이전 규칙 API와 Context map/배열 순서로 명의를 추정하는 함수를 제거했습니다.

월 분할에 전달하던 미사용 삭제 함수, 본인 이름 변경 서비스의 미사용 memberId, 지출 생성의 무시된 알림 option, 미사용 분할 ID/배당 누적/실물 금 전체 갱신 함수를 제거했습니다. 월 분할은 기존 서버 명령 한 번으로 수행하며 본인 권한 확인은 Context/서버에 그대로 있습니다.

## 계약과 검사

- CARD-001/002/005, MER-003/004/006: `settingsSaveFailure`, `merchantRuleReorder`, `merchantRuleCanonicalRead`에서 실제 화면과 서비스 경계의 중복·실패·재시도·version 보존을 검사합니다.
- REC-001: 같은 편집 version/초안 재시도, 가구 전환 뒤 늦은 성공 무간섭, 기존 조회 오류와 정상 빈 결과를 검사합니다.
- HH-009/LED-008: 기존 `androidHouseholdServerFirst`, `expenseDetailModalOwnership`에서 본인 이름 변경과 분할 호출 계약을 보존합니다.
- 설정 관련 4파일 16개 통과. Context/명의/분할 관련 3파일 35개와 Web tsc 확인. 단순 미사용 삭제는 별도 모형 테스트를 만들지 않습니다.

로그: `TEMP/household-simplicity-settings-20261005.log`, `TEMP/household-simplicity-settings-cleanup-20261005.log`.
