# iPhone 첫 홈 서버 조회와 실시간 구독 전환

## 요구사항과 계약

AND-012 / T-WEBVIEW-004, SYS-008 / T-SYS-008, ADM-006 / T-ADM-005를 따른다. 첫 iPhone PWA 홈에서 현재 월 원장, 카테고리, 홈 설정, 지역화폐 잔액을 기존 Auth·Rules를 적용하는 Firestore Lite로 병렬 조회한다. 실제 서버 자료만 표시하고 이후 변경은 기존 realtime SDK로 구독한다. 일반 브라우저·Android, 인접 월 prefetch, 연간 합계는 기존 경로를 유지한다.

각 최초 조회가 완료된 뒤 해당 실시간 구독을 시작한다. 동시 race의 먼저 도착한 값을 무조건 적용하면 먼저 시작한 구독의 오래된 값이 뒤늦게 Lite 값을 덮을 수 있으므로 이 순서를 지킨다. 구독은 첫 서버 snapshot 전의 cache를 무시한다. 홈 설정은 잔액 선택과 카드 구성이 같은 원본을 공유한다. 수정·삭제의 기존 optimistic projection을 통과하고 세션/가구 변경 또는 해제 후 응답은 폐기한다.

Lite 조회 예산은 750ms이다. 실패 또는 예산 초과 시 해당 결과를 영구 폐기하고 기존 실시간 구독으로 복귀한다. 무한 대기나 polling을 추가하지 않는다. 이 경우 기존 구독 시작보다 최대 750ms 늦어지는 비용이 있으므로 운영 표본에서 fallback 빈도와 전체 시간을 함께 판단한다. 첫 홈에만 추가 서버 읽기 비용이 발생하며 문서 재실행 후 다시 적용한다. 실제 SDK의 중단 API가 없는 진행 중 REST 요청은 결과를 무시하며 추가 요청을 반복하지 않는다.

## 진단과 검증

기존 ListenStarted/ServerSnapshotReceived는 실시간 구독 관측 의미를 유지한다. 네 자료의 InitialReadStarted/InitialReadReceived/InitialReadFallback을 선택적 숫자 시각으로 추가한다. 서버 allowlist를 먼저 배포한 뒤 Web을 Git 자동배포한다. 준비 시각은 실제 Lite 성공 또는 실시간 서버 도착 이후여야 한다. 자료·계정·URL 원문을 진단에 추가하지 않는다.

계약 검사는 순서, timeout/실패 복귀, 늦은 응답 폐기, 세션 전환, cache 제외, 중복 홈 설정 구독, 수정/삭제 overlay 보존을 검증한다. 실제 production WebKit과 Firebase Emulator에서 Listen 응답을 보류한 동안 Lite만으로 최신 홈이 표시되고, 해제 후 다른 변경·삭제가 반영되는지 확인한다. 운영 금융 자료는 변경하지 않는다. 실기기 체감 개선은 배포 후 로그로 별도 확인한다.

## 검증 결과

- Web 초기 조회·서버 우선·구독 진단·지역화폐 4파일 36개, Context·초안 보존·설정·런타임 경계 4파일 26개 통과. 서버 진단의 구버전·선택 필드·범위·거부 82개, Functions architecture 45개 및 세 codebase 빌드 통과. 타입 검사와 catalog/E2E 추적성을 확인했다.
- 실제 Firebase Emulator + production WebKit 3개 통과(44.5초). 실제 Listen 요청을 보류한 동안 네 Lite 조회 성공, 서버 snapshot 없는 첫 홈, 12,300원 지출·카테고리·36,890원 지역화폐를 확인했다. 보류 해제 후 실제 canonical 변경 15,400원·메모 및 삭제 반영을 확인했다. 기존 지연 chunk 실패·재시도·편집과 로그인 재실행/최신 값/전체 진단도 통과했다.
- 실제 production Chromium의 홈 설정 Command·충돌·중복 거부·새로고침과 테마 검사 2개 통과(29.8초).
- 기존 회귀 fixture의 매 호출마다 새 scope를 반환하는 mock을 실제 불변 세션 scope로 보정했다. 성공/실패 및 cache·delta 검증 기준은 유지한다. 첫 production build의 use-client 지시문 위치 오류를 수정하고 production build와 브라우저 검사를 통과했다.
- 이전 d727a45의 CI 37190951536은 다섯 검사와 요약 모두 성공했다. 이전 37190669714의 web-e2e도 성공이며 해당 실행의 기존 web 실패 기록은 유지한다.

로그는 저장소 밖 TEMP/household-ios-initial-{unit,regression,incremental,prepare,e2e,preferences-e2e}-20261004.log이다. 이 결과는 실기기 속도 측정이 아니다. 750ms 예산에 동적 모듈 로드를 포함하며 운영의 fallback 비율과 동일 조건 전체 실행 시간으로 효과를 판정한다. Firestore의 기본 서버 읽기 일관성은 [공식 문서](https://firebase.google.com/docs/firestore/understand-reads-writes-scale)를 참고했다.
