# 남은 전체 계약 단순화 전달 기록 — 2026-10-05

## 범위와 변경

기준 `676731d9abda95439afc2dfd827690029d89e048`에서 [19개 모듈·239개 요구사항의 계약별 판정](../verification/contract-simplicity-2026-10-05/README.md)을 완료했습니다. 기존 감사의 변동 없는 근거와 이번 직접 검토·변경을 구분했습니다. 목표 명세·운영 호환·권한·원자성·멱등성은 감축을 위해 삭제하지 않았습니다.

실행 코드 변경 44파일 전체는 7,061→5,195줄, 1,866줄 감소입니다. 이는 변경 파일 범위이며 저장소 전체 감소율이 아닙니다. 실제 경로의 중복 상태/초기화/오류 선택/저장 처리를 정리했고, 남아 있던 미사용 대체 경로와 전용 타입을 제거했습니다. 테스트·문서와 생성물은 감축에 포함하지 않았습니다. [파일별 측정](../verification/contract-simplicity-2026-10-05/runtime-change-scope.json).

- Web: 지출 수정·삭제 공통 pending/실패 복구, 편집 인스턴스 단일 초기화, 실물 금 시세 파생값, PWA 알림 직접 export.
- Functions: 자산·보유·자동화 검증 및 실패 저장 단순화, 실제 원장/정기/카테고리/배당 경로와 중복된 미사용 모형 제거, Shortcut 설치 재포장 제거, 홈 카드 키 단일 정의.
- 홈 카드의 객체 상속 키 검증 누락은 application 회귀 3개에서 재현했습니다. 제한된 Map으로 원천 조회를 고쳐 추가 예외 분기 없이 거부하며 실제 callable도 검사합니다.
- Android 실행 코드·공용 wire schema·운영 금융 데이터는 변경하지 않습니다. APK 신규 발행은 필요하지 않습니다.

## 검증

| 경계 | 결과·근거 |
|---|---|
| 단위/정책/UI | Finance 33파일 285개, Capture/Notifications Functions 36파일 544개, Portfolio 관련 정책·adapter, 각각 연결된 Web 검사가 통과했습니다. 이 범위들은 중복될 수 있어 총합으로 보고하지 않습니다. 각 계약 보고서의 정확한 목록과 범위를 따릅니다. |
| 지출 편집 | Jest 5파일 38개. 부모 실제 useExpenseEditor의 목록 갱신·같은 거래 재선택, pending 숨김·실패 후 초안·늦은 응답 격리를 확인했습니다. |
| 홈 카드 키 | 서버 3파일 9개. 기존 세 가지 잘못된 키가 통과하던 application 검사는 변경 전 3실패→변경 후 성공입니다. |
| 실제 Firestore | 4파일 33개 통과(22.26초). 원장 Update/Split 두 승자 경합, 지역화폐 잔액/최초 선택, 자동화, Shortcut credential rotation. Storage/Android 실제 검사를 이번 실행에 포함했다고 주장하지 않습니다. |
| 준비 build | architecture 10파일 43개, Functions production build와 세 codebase 준비 통과. |
| 타입 | Functions 실행/검사 타입 및 Web 타입 검사 통과. 새 테스트에서 현재 TS lib가 지원하지 않는 Error cause 인자를 사용한 오류는 기존 Error 재throw로 교정했습니다. |
| 교차 검토 | Portfolio 오류 우선순위·attention target/read/write 순서·금 초안, Finance 실제 handler/대체 검사, Web 편집 생명주기/홈 설정 호환성을 다른 담당자가 읽기 전용 검토했습니다. 추가 회귀는 발견하지 못했습니다. |
| 실제 브라우저 | Chromium 4파일 22개 통과(1.6분). production Web build와 실제 Auth/Firestore/Functions Emulator를 거쳐 원장·자산·홈 설정·Shortcut 흐름을 확인했습니다. |
| 런타임 경계 | 검사 통과, 경계 위반 0건. |

검증 약화·무변경 재실행을 하지 않았습니다. 로컬 Emulator 이외의 금융 자료를 검증용으로 변경하지 않았습니다. 로그는 `TEMP/household-contract-{editor,home,home-invalid-red,types-functions,types-web}-20261005.log`, `TEMP/household-contract-simplicity-{sdk,prepare,e2e}-20261005.log`입니다.

## 배포·CI

서버·Web 대상입니다. 서버는 기존 Firebase release wrapper의 세 codebase·로그인 smoke, Web은 main Git 자동배포를 사용합니다. 실제 배포 결과는 release provenance와 GitHub Deployment에서, 원격 CI의 다섯 검사와 결과 요약은 해당 후보 SHA의 Actions 실행에서 확인합니다. 미완료 원격 결과는 기존 CI 후속 확인에 정확한 SHA와 실행 번호로 전달하며, 로컬 검증 성공을 원격 CI 성공으로 취급하지 않습니다.
