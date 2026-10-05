# 실제 통계·배당 계약으로 정리

FIN-02와 WE02를 처리합니다. 호출 관계를 조사해 운영 bootstrap·scheduled runtime·Web에서 소비하지 않는 Functions Reporting 패키지, 그 전용 fixture·계약 검사, 포트폴리오 대체 계산·취소 명령을 제거했습니다.

## 삭제와 실제 계약 소유자

- Reporting 서버 controller/query/model 대신 Web statisticsPeriod·expenseStatisticsReadModel·assetStatisticsReadModel·StatsPage·AssetStatsPage를 유일 실행 경로로 문서화했습니다. 실제 조회 page 완성·상한·cursor·실패·세션 격리와 화면의 수정/삭제·캐시·기간·0원 검사를 유지했습니다. 실제 화면에서 빈 중간 월 0과 총액 일치를 보강했습니다.
- selectDaily/HouseholdValuationTargets, buildDailyAssetSnapshotIntent, normalizeAndValueGold, normalizeValuationAssetLifecycle, calculatePositionAccountState, applyPositionMutation, buildAutomationDueTasks, 배당 projection 대체 계산은 실제 호출자가 없습니다. 실행 중인 accountValuation·revalueAssetFromPositions, runtime portfolio 저장, automation runtime과 배당 repository는 유지합니다.
- Map을 기반으로 한 별도 DividendEvent 상태기계를 제거했습니다. 실제 Firebase scheduled runtime 검사에 기준일 이전 announced 보존·paid 이후 과거 날짜 호출 무변경을 추가했습니다. 기존 공시 identity·수량 이력·정정·paid 보존·연간 projection 검사를 실행했습니다.
- 미사용 cancelCapturedLineage 명령·store/model을 제거했습니다. 실제 transformationLineageService와 FirebaseCaptureLedgerPersistence의 취소 graph는 유지합니다.
- 원래 조사 문서의 삭제된 파일 링크는 조사 시점 Git revision으로 고정했습니다. 현재 실행 경로와 역사적 근거를 혼동하지 않습니다.

## 숨겨져 있던 목표 명세

기존 독립 서버 fixture의 성공이 실제 Web 기능 완성을 뜻하지 않았습니다. 과거 owner dimension 자료 보존은 실제 adapter로 검증하지만 명의자 필터 UI/기간별 초기화는 현재 제공되지 않습니다. 여러 SDK page의 서버 checkpoint 고정도 실제 보장은 아닙니다. 이 목표들은 요구사항에 남겨 두고 상세 설계에 차이를 명시했습니다. 정비를 이유로 새 UI를 만들거나 미구현 기능을 완료 처리하지 않습니다.

## 첫 홈 빌드 검사

실제 production dynamic-import manifest에서 기능별 파일을 읽도록 바꿨습니다. 여섯 개의 사람이 붙인 파일명과 기능별 정확히 한 파일이라는 전제를 없앴습니다. 닫힌 기능의 조기 요청 차단, 첫 paint 이후 날짜 내역 준비, 반복 선택의 다운로드 재발생 방지, 검색 코드 요청 실패·재시도와 실제 편집 저장은 유지합니다. 공유 chunk는 기능 코드와 구분합니다.

## 추적성과 검증

- 실행 case 추출기는 Vitest의 세 번째 timeout 인자 뒤에서 callback을 찾지 못했습니다. 함수 인자를 직접 찾아 timeout이 있는 실제 SDK case도 추적하도록 수정했습니다. skip/todo와 주석은 여전히 증거가 아닙니다.
- 실제 Web 정책·조회·화면 5개 파일 95개. 마지막 새 빈 월 검사의 기간 선택을 명시한 뒤 해당 StatsPage 24개 통과.
- 실제 Firestore 배당 scheduled runtime 14개 통과.
- Functions 전체 타입 검사는 미사용 구현 삭제 뒤 통과했습니다.
- production build 포함 Chromium 자산·통계 6개, iPhone WebKit 첫 홈·재진입 2개 통과.
- Functions architecture 10개 파일 43개, Web 타입 검사 통과.
- 직전 CI `37266253223`의 실패는 timeout 인자가 있는 실제 SDK case를 누락한 추적성 추출기 때문입니다. 해당 실행을 다시 실행하거나 성공으로 덮지 않고 추출기를 고친 후속 후보에서 검증합니다.
