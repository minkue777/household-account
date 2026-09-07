# 반복 호출 경로 추가 최적화

## 기준과 범위

2026-09-07 21:32 KST에 확보한 관리자 대시보드의 직전 24시간 집계를 기준으로 조사했다. 이 표는 서버 측 측정 대상 호출의 빈도이며, Firestore를 직접 구독하는 화면의 사용 빈도 순위는 아니다.

| 호출 | 성공 표본 | 서버 평균 | 이번 조치 |
| --- | ---: | ---: | --- |
| 로그인 사용자 상태 확인 | 32 | 282.9 ms | canonical 문서 3개 읽기 일괄화 |
| Android 결제 알림 수집 | 28 | 356.9 ms | 승인 receipt·중복 방지 문서의 첫 transaction 읽기 일괄화 |
| 앱 방문 기록 | 20 | 415.9 ms | 기존 최적화 유지, 추가 변경 없음 |
| 알림 수신 단말 등록 | 9 | 698.6 ms | 멱등성·권한 보장을 검토하고 현재 처리 유지 |

별도로 거래 추가·수정·삭제·알림 수집 결과마다 실행되는 웹 월간/기간 원장 변환을 개선했다. 이 경로는 기존 서버 호출 집계에 포함되지 않는다. 운영 데이터 수정이나 알림 전송으로 측정하지 않았다.

## 로그인 사용자 상태 확인

`firebaseSignedInUserResolver`는 active projection 조회 후 canonical membership·member·household를 읽는다. 후반의 개별 `get()` 3개를 동일한 참조 순서의 `getAll()` 1개로 묶었다. 정상 경로의 읽기 API는 4회에서 2회가 되며, 읽는 문서 수는 같다.

후반 세 문서는 원래 병렬로 요청했으므로 필수 대기 단계를 절반으로 줄이는 변경은 아니다. RPC 호출 오버헤드를 줄이며 권한 캐시를 새로 두거나 검증을 생략하지 않는다. projection 중복·canonical identity·member link/version/capabilities·비활성/삭제 상태 검증을 유지한다. 동일 resolver를 쓰는 WebView 세션 토큰 발급도 이 경로를 사용한다.

## 결제 알림 승인 저장

`FirebaseCaptureLedgerPersistence.recordApproval`의 첫 receipt/dedup 읽기를 같은 transaction의 `getAll()`로 묶었다. 기존 `Promise.all([transaction.get(...), transaction.get(...)])`도 설치된 Firestore SDK에서 첫 transaction ID가 만들어지기 전에는 두 번째 읽기가 대기한다. 한 batch로 두 문서를 요청하면 이 초기 대기를 줄인다.

이전 HEAD의 실제 구현과 새 구현을 가상 Firestore 시계로 비교했다. RPC당 100 ms, 추가 commit 지연 0 조건에서 Android와 iOS가 공유하는 일반 승인 경로 모두 아래와 같았다.

| 항목 | 전 | 후 |
| --- | ---: | ---: |
| 첫 읽기 RPC | 2 | 1 |
| 읽기 시작 시각 | 0, 100 ms | 0 ms |
| 완료 시간 | 200 ms | 100 ms |
| 읽은 문서 | 2 | 2 |
| 저장 문서 | 6 | 6 |

응답 및 저장 문서 전체가 동일했다. 이는 제어 실험이며 운영 평균 356.9 ms의 배포 후 감소 폭을 예측하는 수치가 아니다. 단일 transaction, receipt 우선 재생, payload mismatch 거부, 중복/취소된 dedup 판정, 실패 시 전체 미저장, 재시도 시 새 snapshot 검증을 유지한다.

실험 자료는 로컬 임시 디렉터리의 `capture-approval-benchmark-20260907/results.json`과 `benchmark.log`다.

## 원장 실시간 갱신

기존에는 snapshot마다 전체 문서의 표시 가능 여부를 확인하고 전체 거래를 다시 변환했다. 이제 listener마다 Map을 보유하고 첫 허용 응답은 `docs` 전체로 구성한 뒤, 이후 `docChanges()`의 added/modified/removed만 처리한다. 월 원장은 초기에 cache 응답을 무시하므로 첫 서버 응답을 전체 문서로 구성해야 빠진 거래가 없다. Firestore의 변경 목록과 메타데이터 이벤트 동작은 [공식 listener 문서](https://firebase.google.com/docs/firestore/query-data/listen)와 [SnapshotListenOptions](https://firebase.google.com/docs/reference/js/firestore.snapshotlistenoptions)를 확인했다.

변경되지 않은 거래의 객체 참조를 유지한다. 첫 응답 이후 거래 1,000건 중 한 건 수정 조건에서 변환 거래 수는 1,000→1이며, 표시 여부 검사와 변환을 합친 `document.data()` 호출은 2,000→1이다. 구형 전체 변환 결과와 새 결과의 모든 필드가 같고 기존 정렬 순서도 유지됨을 검사했다. 첫 전체 응답에서도 동일 문서 데이터를 두 번 읽던 것을 한 번으로 줄였다.

이 수치는 클라이언트 메모리 내 처리 횟수이며 Firestore 네트워크 조회량이나 과금 읽기 수 감소를 뜻하지 않는다. 현재 배열 생성·필터·정렬·원장 projection 검증은 계속 수행한다.

- 메타데이터만 바뀐 응답도 projection에 전달하므로 서버 확정과 낙관적 수정의 수렴 조건을 생략하지 않는다. 다만 데이터가 같으면 다시 변환하지 않는다.
- 추가·숨김·삭제·범위 이동·원복을 모두 처리한 후 snapshot별 완성된 목록을 한 번 전달한다. `aggregateVersion`만 비교하여 실제 문서 변경을 무시하지 않는다.
- listener마다 소스를 격리하여 다른 가구나 기간의 데이터를 섞지 않는다.
- 디코딩 실패 중간 결과는 표시하지 않고 증분 기준을 버린다. Firestore의 변경 기준은 실패한 이벤트도 지나가므로, 다음 응답의 전체 문서에서 다시 구성해야 그 이벤트의 변경이 누락되지 않는다. 독립 리뷰에서 발견한 이 경우를 보완하고 실패 다음의 부분 변경만으로도 전체 최신 상태를 복구하는 검사를 추가했다.

## 유지한 경로

앱 방문 기록은 최신 멤버십 claim 확인 후 이미 `getAll(stats, visit)` 한 번으로 읽고 원자적으로 기록한다. 통계와 영구 visit receipt는 현재 결과 및 오래된 재전송 차단에 필요하므로 제거하지 않았다.

실제 단말 등록 handler는 endpoint 문서를 한 번 읽은 snapshot으로 판단하고 저장한다. 다른 endpoint application의 코드를 고쳐도 현재 운영 경로에는 효과가 없다. 공통 receipt를 endpoint commit에 통합하려면 별도 멱등 계약 설계가 필요하며, 단순 삭제는 재전송의 version/확인 시각 의미를 훼손할 수 있어 이번에는 변경하지 않았다.

기존 로컬 최적화는 보존했다. 이번 변경에 커밋·push·운영 배포·APK 릴리스는 포함하지 않으며, 실제 성능 개선 폭은 운영 반영 후 같은 호출·성공 여부·revision 조건으로 확인해야 한다.

## 로컬 검증

- Functions `test:quality-gate`: 320개 suite / 2,803개 통과, 기존 별도 integration용 78개 skip. 테스트 타입·런타임 경계·architecture 38개·production build 통과.
- Web 전체: 98개 suite / 600개 통과. 별도 TypeScript 검사 통과. 프로젝트의 낮은 JavaScript target에서도 동작하도록 Map 결과 배열 생성에 `Array.from`을 사용했다.
- 실제 Firestore Emulator `test:firebase-finance-commands`: 16개 통과. 결제 수집 승인·취소와 원장 저장/원복을 포함한다.
- Firebase Emulator 브라우저 E2E: 로그인·원장 추가/수정/삭제·통계 기간 전환·알림 편집 주소 흐름 1개 통과. 로컬 Emulator는 호스트 Node 24를 사용했으며 운영 설정 Node 22는 변경하지 않았다.
- Web production build 통과. 정적 HTML 12개·CSP hash 25개·root worker 1개 검증 및 해당 빌드의 PWA E2E 2개 통과.
- 로그인 resolver와 WebView 발급 관련 집중 검사 53개, capture 승인 관련 30개, 원장 증분 처리 8개를 포함한다. 로그인은 batch 결과 전체 확인 전 토큰 발급 0회, capture는 재시도/실패 원자성, 원장은 누락·숨김·정렬·메타데이터·실패 후 전체 복구를 검증했다.

로그는 로컬 임시 디렉터리의 `frequent-operations-functions-gate.log`, `frequent-operations-web-tests.log`, `frequent-operations-web-focused.log`, `frequent-operations-web-incremental.log`, `frequent-operations-finance-integration.log`에 남겼다. 원장 구현과 서버 수정은 각각 독립 리뷰를 받았다.

최종 브라우저·산출물 검증 로그는 같은 디렉터리의 `frequent-operations-web-e2e.log`, `frequent-operations-web-build.log`, `frequent-operations-web-pwa.log`다. Git HEAD는 `5d66067147807a3e542833f53939318d4c8ac834`로 유지되며 staging한 파일은 없다. 실제 운영 성능을 개선했다고 확정한 측정값은 아직 없다.
