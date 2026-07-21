# 목표 계약 테스트 구현 로드맵

> 기준일: 2026-07-21  
> 기준 문서: [요구사항 기반 테스트 전략](../requirements/governance/test-strategy.md), [목표 Clean Architecture](../architecture/target-clean-architecture.md)  
> 실행 안내: [Functions 계약 테스트](../../functions/test/README.md)

## 1. 상태 의미

| 상태 | 의미 | release 판정 |
|---|---|---|
| Active | 공유 schema·fixture 또는 Architecture Fitness Function에 연결되어 assertion 실행 | 다른 필수 gate와 함께 통과 필요 |
| Implemented | 목표 모듈의 공개 Input Port와 실제 Domain/Application 구현에 연결되어 assertion 실행 | Adapter·통합 gate와 함께 통과 필요 |
| Ready | 공개 Subject와 Given/When/Then 본문이 완성됐지만 목표 Input Port가 없어 `describe.skip` | 아직 미통과 |
| Pending decision | 제품 결과를 정할 수 없어 해당 시나리오만 `test.todo` | 아직 미통과 |
| Planned | Adapter·Repository·UI 같은 다음 테스트 계층의 작업 경계만 정함 | 미착수 |
| Legacy characterization | 교체 전 동작을 기록하지만 목표 구현의 합격 기준으로 사용하지 않는 의도적 `describe.skip` | release 판정에서 제외 |

2026-07-21 최종 실측 결과는 **목표 Context 2,138개 + 공유 wire·운영 계약 35개 + Architecture 33개 + Adapter·bootstrap·read-side 93개 = 일반 suite 2,299개 통과**입니다. 별도 Emulator 환경에서만 활성화되는 46개도 모두 통과해 release 근거가 되는 활성 테스트는 총 2,345개입니다. 교체 전 PWA legacy characterization 1개만 의도적으로 skip되며 제품 결정 `test.todo`는 0개입니다.

## 2. Active 공유 계약

| 독립 경계 | 실행 artifact | 활성 assertion | 추적 범위 |
|---|---|---:|---|
| 계약 테스트 독립성 | production 내부 계층·SDK import와 mock interaction·상수 assertion 금지, 공개 Subject 강제 | 3 | Clean Architecture, 구현 비의존성 |
| 요구사항 추적성 | 요구사항 단일 소유, Context 지도 합계, Canonical 선언·양방향 참조, 모든 요구사항의 테스트 본문 직접 연결, `추가 예정`·미결정 todo 검사 | 10 | 231개 요구사항과 210개 Canonical 테스트 전체 |
| 문서 상대 링크 | `docs/`의 모든 로컬 Markdown 링크 대상 존재 검사 | 1 | T-REL-001, REL-001 |
| Production 의존 방향 | Domain·Calculation의 안쪽 의존, 모듈 간 `public.ts` 경계, 공개 API의 Outbound Port·Adapter 비노출 | 3 | Clean Architecture dependency rule |
| Cloud 예약 작업 | `ScheduledJobManifest.v1` schema·fixture | 4 | T-JOB-001, T-DIV-003, T-REC-005, AUTO-003 |
| 연도 없는 결제 시각 | 공용 year fixture·schema | 3 | T-PARSE-003, T-PARSE-TIME-001 |
| 채널 중립 Capture 입력 | `CaptureEnvelope.v1` schema·Android/Shortcut fixture | 7 | ING-001, ING-002, IOS-001, Capture Intake |
| Android raw server parsing 입력 | `AndroidRawNotification.v1` schema·fixture·strict decoder | 2 | ING-001, ING-002, DEC-066 |
| Shortcut HTTP wire | request/response schema·비식별 fixture | 3 | IOS-001, IOS-008~010, IOS-012 |
| 비식별 raw parser golden fixture | Android 등록 package 13종과 Shortcut 지원 카드사의 승인·취소·잔액·거부 원문 fixture | 4 | T-PARSE-001, T-PARSE-002, T-PARSE-004 |

이 artifact는 현재 production 코드의 함수명·저장 경로·SDK 호출 순서를 검사하지 않습니다. 이후 Android·Web·Functions producer와 consumer가 같은 schema를 소비하도록 연결합니다.

## 3. Implemented 목표 계약

목표 모듈의 실제 `public.ts` Input Port와 Domain/Application 구현에 연결한 범위입니다. 저장소가 필요한 계약은 내부 Outbound Port와 `test/support`의 In-memory Adapter로 조립했으며, 테스트 전용 fixture·fault API는 production 공개 경계에 노출하지 않습니다.

| 소유 경계 | 활성 계약 파일 | 활성 시나리오 | 구현된 핵심 결과 |
|---|---:|---:|---|
| Access & Household | 13 | 145 | Google 최초 진입·5분 초대, legacy claim, 가구·멤버 생명주기, Guard, member/dependent 명의자 분리 |
| Household Finance | 33 | 250 | Category·예산, 원장 CRUD·조회·변환, 정기 거래, 지역화폐 관찰·구독 |
| Notifications | 12 | 108 | 채널별 알림 대상, 다중 FID lifecycle, 보안 경계, 전달·정합성·purge |
| Payment Capture | 39 | 579 | Android·Shortcut parsing/intake, Queue, 중복·취소 계보, 카드·가맹점·credential 정책 |
| Portfolio | 34 | 245 | 자산·Position 생명주기와 평가, 자동화, 시세·펀드, 배당 discovery·상태 전이·복구 |
| Android Host | 17 | 186 | Native 인증 인계, Bridge 인가, QuickEdit FIFO·분할·충돌, SessionScope·wire 계약 |
| Delivery Assurance | 3 | 87 | 필수 release gate, 운영 target 호환성, artifact·smoke·rollback provenance |
| External Operations | 9 | 104 | JobRun 실행·감시, 안전한 ingress/HTTP/HTML, provider health·이메일 경보 |
| Home Preferences | 6 | 48 | 가구 공유 카드·테마·지역화폐 선택, 권한·멱등·version 충돌과 독립 변경 |
| PWA | 8 | 287 | 단일 root worker, 안전한 update와 SessionScope 격리, cache·push·navigation·보안 header |
| Reporting | 10 | 54 | 통계 기간·집계, 자산 기간·연속성, bounded source, 늦은 응답 폐기, 권위 재조회 |
| 공통 시스템 계약 | 5 | 45 | Money·날짜·Instant, tenant·SessionScope, migration, member reference, Unit of Work |
| 합계 | 189 | 2,138 | 실제 목표 Domain/Application 공개 계약과 연결된 전체 Context suite |

목표 Context 밖의 release 검증은 공유 wire·운영 계약 10개 파일/35개, Architecture Fitness Function 9개 파일/33개, Adapter·bootstrap·read-side 단위 계약 33개 파일/93개입니다. Firestore Rules·Storage Rules·Firebase Adapter 통합 12개 파일/46개는 일반 `npm test`에서는 환경 조건으로 skip되고 전용 Emulator 명령에서 모두 실행됩니다.

## 4. Ready 및 의도적 skip

목표 Input Port 구현을 기다리는 Ready 파일과 제품 결정이 남은 todo는 없습니다. 이전 Ready suite는 모두 실제 Domain/Application 공개 계약에 연결되어 위 Implemented 범위로 이동했습니다.

| 분류 | 파일 | skip 시나리오 | 유지 이유 |
|---|---:|---:|---|
| PWA legacy characterization | 1 | 1 | [교체 전 `skipWaiting` 동작](../../functions/test/contexts/supporting-platform/pwa/legacy-worker-activation-characterization.contract.test.ts)을 이력으로 보존합니다. 목표 동작은 [worker update·SessionScope 계약](../../functions/test/contexts/supporting-platform/pwa/worker-update-session-isolation.contract.test.ts)이 검증하므로 활성화 대상이 아닙니다. |
| 합계 | 1 | 1 | 목표 계약 누락이 아닌 의도적 비실행 특성화 |

이 legacy 파일은 release 통과 근거로 계산하지 않습니다. 목표 계약에는 `describe.skip`이나 `test.todo`가 남아 있지 않습니다.

## 5. 결정 처리 현황

현재 `test.todo`는 없습니다. Q-001은 DEC-063으로 확정되어 정기 거래 creator 계약 6개가 Implemented suite에 연결됐고, Q-002는 기존 DEC-011과 중복되어 `T-AUTO-002` 계약으로 연결했습니다. Q-003은 일반 사용자 복구 금지와 운영 복구일 기준 재개로 확정되어 `T-AST-002`·`T-AUTO-003` 계약 10개가 Implemented suite에 연결됐습니다. Q-004는 DEC-033의 원문 최초 응답 1회·`AlreadyIssued` 재전송 정책으로 확정되어 `T-IOS-SEC-002` 계약 1개가 Implemented suite에 연결됐습니다. Q-005는 별도 카드별 Reporting이 아니라 기존 Ledger 카드 검색과 검색 결과 월별 합계 요구였음을 확인해 제거했으며, `T-SEA-001`·`T-SEA-003` 계약으로 명시했습니다.

Q-006은 [DEC-064](../requirements/governance/decisions.md#dec-064)로 확정했습니다. 필수 release gate가 하나라도 실패하면 waiver가 있어도 `EvaluateReleaseCandidate`는 rejected를 반환하고 deploy authorization을 만들지 않으며, 실패 후보를 승인으로 바꾸는 별도 override Port도 두지 않습니다. 이 결과는 `T-REL-001` Implemented 계약에 명시되어 있습니다. 현재 남은 제품 결정 `test.todo`와 미결정 질문은 모두 0개입니다.

2026-07-22 운영 확인에서 발견한 세 호환 경계도 계약 문서에 환류했습니다. Shortcut parser는 정확한 선두 `[Web발신]`만 제거하는 golden fixture로, 자동 수집 거래는 Canonical `cardDisplay`와 legacy `cardLastFour` 표시 Projection의 동등성으로, 일반 거래 삭제는 [DEC-065](../requirements/governance/decisions.md#dec-065)의 논리 삭제·active-only 조회 계약으로 고정했습니다. 현재 활성 `T-PARSE-004`, Firebase capture persistence Adapter test, `T-LED-001`·`T-LED-008` 및 Web `ledgerReadVisibility` 계약이 각각 회귀를 막습니다. 운영자 전용 삭제 거래 복구·영구 정리는 일반 사용자 기능이 아니며, 실제 운영 도구를 구현할 때 별도 감사·종속 lineage 계약을 추가합니다.

## 6. 다음 테스트 계층

계약 본문을 더 늘리기보다 아래 계층을 Vertical Slice마다 추가합니다.

비식별 raw golden fixture는 active 상태로 작성했습니다. 다음 계층은 fixture를 실제 목표 parser에 적용하는 conformance부터 아래 순서로 연결합니다.

1. Provider parser conformance: active raw golden fixture를 Functions Android·Shortcut parser에 적용하고 Android에는 공급자 parser 복사본을 두지 않음
2. Repository Conformance: 같은 suite를 In-memory와 Firestore Adapter에 공통 적용
3. Firebase Emulator: Rules, transaction 경합, receipt·fingerprint, Outbox/Inbox 원자성 검증
4. Producer/consumer conformance: Android `AndroidRawNotification.v1`, Shortcut HTTP Adapter, Functions raw decoder/Intake가 각 공개 JSON schema를 왕복
5. Android instrumentation: Keystore AES-256-GCM, process 복구, backup 제외, QuickEdit Activity lifecycle
6. Browser/UI: PWA worker update, SessionScope 전환, 미저장 form 보존, 접근성
7. Release pipeline: requirement ID·상대 링크·Rules/index·smoke를 실제 gate evidence로 연결

## 7. Vertical Slice 활성화 순서

1. 새 Vertical Slice의 Subject를 소유 모듈 `public.ts`의 Input Port와 대조합니다.
2. Framework 없는 Domain Policy를 구현하고 순수 계약만 먼저 활성화합니다.
3. Application handler와 In-memory Port를 연결해 권한·오류·멱등 계약을 활성화합니다.
4. 같은 Repository Conformance Suite를 Firestore Adapter에 연결합니다.
5. Emulator에서 transaction 경합·Rules·Outbox/Inbox를 검증합니다.
6. 기존 Web·Android·Functions 경로를 inbound/legacy Adapter로 전환합니다.
7. 목표 계약과 중복되는 구현 결합 테스트만 마지막에 정리합니다.

각 단계는 다른 기능 suite를 함께 활성화할 필요가 없습니다. 한 모듈 변경 때문에 다른 모듈의 테스트 대역이나 내부 파일을 수정해야 한다면 공개 계약 또는 경계 배치가 잘못된 것으로 봅니다.
