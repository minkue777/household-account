# 카테고리 통합과 중복 저장 종료

## 범위

카테고리는 `households/{householdId}/categoryCatalog/current` 한 문서로 저장합니다. 항목 ID·순서·개별 버전·예산·보관 상태·기본 카테고리는 유지하며, 과거 물리 ID는 `categoryAliases`에 보존합니다. 보관 작업의 checkpoint·receipt·Outbox는 별도 문서로 유지합니다.

거래·자산·보유종목·카드·가맹점 규칙은 이미 존재하는 가구별 canonical 문서만 읽고 씁니다. 기존 flat 문서와 병합 조회하거나 중복 저장하지 않습니다. 정기지출 계획·지역화폐·알림·배당의 저장 구조 자체는 이번 통합 대상이 아닙니다.

| 데이터 | 실행 경로 | 복구용 기존 자료 |
|---|---|---|
| 카테고리 | `households/{h}/categoryCatalog/current` | `categories`, `households/{h}/categories`, `categorySettings/default` |
| 거래 | `households/{h}/ledgerTransactions/{id}` | `expenses/{id}` |
| 자산 | `households/{h}/assets/{id}` | `assets/{id}` |
| 보유종목 | `households/{h}/assets/{assetId}/positions/{id}` | `stock_holdings/{id}`, `crypto_holdings/{id}` |
| 카드 | `households/{h}/registeredCards/{id}` | `registered_cards/{id}` |
| 가맹점 규칙 | `households/{h}/merchantRules/{id}` | `merchant_rules/{id}` |

카테고리 구독은 기존 가구별 7·8·12개 문서에서 1개로 줄어듭니다. 변경 대상의 중복 본문 쓰기도 제거되지만 receipt·claim·Outbox·관련 도메인 갱신은 그대로 필요하므로 전체 비용이나 응답 시간이 절반으로 줄어든다는 의미는 아닙니다.

## 이관 도구

`functions/scripts/consolidate-storage.mjs`는 운영 배포 Functions에 포함되지 않는 일회성 운영 도구입니다. 업무별 사전 검증은 ledger·portfolio·payment 모듈로 분리하며 카테고리 스키마는 실제 runtime 검증기를 재사용합니다. 기존 일반 V1→V2 migration을 다시 실행하는 도구가 아닙니다.

```powershell
npm --prefix functions run build
node functions/scripts/consolidate-storage.mjs --project household-account-6f300 --plan-file "$env:TEMP\household-storage-consolidation-plan.json"
```

계획은 읽기 전용이며 민감한 원본·변경 전 복구 자료는 저장소 밖의 private plan에만 기록합니다. 콘솔에는 문서 수·오류 유형별 건수·plan hash만 출력합니다. `issueCounts`가 비어 있고 구형 클라이언트 사용 중단이 확인된 뒤 동일 계획 hash를 명시하여 적용합니다.

```powershell
node functions/scripts/consolidate-storage.mjs --project household-account-6f300 --plan-file "$env:TEMP\household-storage-consolidation-plan.json" --apply --expected-plan-hash <검토한-hash>
```

전체 계획의 원본과 대상 updateTime을 첫 쓰기 전에 검증하고, 100개 이하의 변경을 묶은 transaction 안에서 다시 검증합니다. 동시 수정은 중단합니다. 이미 정확히 적용된 문서는 재실행 시 쓰지 않으므로 부분 완료 뒤 재개할 수 있습니다. 기존 문서 삭제·구성원 임의 재배정·충돌 덮어쓰기는 수행하지 않습니다. Firestore Timestamp는 계획 파일을 경유해도 원본 정밀도를 보존합니다.

## 배포 전환

기존 Android Quick Edit는 flat 카테고리를 직접 읽고, PWA의 실행 중인 이전 번들도 자동 교체되지 않습니다. 기존 문서를 보존하는 것만으로 구형 클라이언트가 최신 데이터를 볼 수 있게 되지는 않습니다.

1. 코드·Rules/index·서명 APK 및 관련 검증을 준비합니다.
2. 짧은 사용 중단 시점을 확인합니다. 결제 알림 수집·예약 작업은 UI 종료와 별개이므로 이관 전후 원본 변경을 대조합니다.
3. 최종 읽기 전용 계획을 생성·검토하고 이관합니다.
4. Firebase wrapper로 서버와 Rules/index를 배포하고 인증된 smoke를 확인합니다. 서버 배포 직후 catalog와 이전 원본이 전환 사이 달라지지 않았는지 재확인합니다.
5. `main` push로 Web 자동배포를 진행하고 같은 commit의 서명 APK를 GitHub Release에 공개합니다.
6. 실제 사용하는 Android의 새 APK 설치와 아이폰 PWA 갱신을 확인한 뒤 사용을 재개합니다.

이관 후 업무 쓰기가 시작되면 기존 flat 자료는 더 이상 최신 원본이 아닙니다. 단순히 이전 서버로 되돌리지 않고 변경된 canonical 데이터를 기준으로 forward-fix하거나 역이관 계획을 따로 검토합니다.

## 준비 중 확인한 근거

- 세 가구에 기존 거래 3,202건, 카테고리 27개, 자산 38개, 보유종목 44개, 카드 33개, 규칙 44개가 있습니다.
- canonical에만 있던 거래 108건은 superseded/삭제 감사 이력으로 확인했으며 보존합니다.
- 과거 카드 표시 라벨과 끝 번호의 표현 차이, 기존 migration manifest에서 보정한 규칙 우선순위는 새 값으로 추측해 덮지 않습니다.
- 실제 Firestore에서 기본분류·0원 예산·별칭·Timestamp 보존, 업무값 충돌, 원본/대상 동시 수정, 재실행·부분 재개를 검증했습니다.
- 운영 사전 대조 계획 hash: `3317321742b83b70acca050f940a74bc9d2f87e211ba062e603d54b7cb6f6f0a`, 충돌 0건, 보강 대상 1,068문서. 적용 직전 원본 revision을 다시 검증하며 변경되었으면 새 계획을 생성합니다.
- 검증: Functions 단위·계약 1,800개, 전체 Web 773개, Rules 에뮬레이터 15개, 실제 이관 5개, 주요 브라우저 E2E 38개(첫 실행 35개 성공 + 발견한 3건 수정 후 재검증 성공). 추가 이관/표시/삭제 회귀도 별도로 통과했습니다.
- 브라우저 검증에서 거부된 카테고리 명령의 불필요한 시간값 쓰기, 보관 명의 표시 누락과 표시 이름으로 인한 자산 삭제 충돌을 수정했습니다. admin 방문 계수 테스트는 초기 실제 접속 요청 완료 후 중복 여부를 관측하도록 수정했습니다.
- Android 1.2.28(versionCode 30) JVM 테스트·계측 테스트 컴파일·서명 Release 빌드를 완료하고 APK Signature Scheme v2 검증을 통과했습니다. 이번 로컬 실행에서는 Android 에뮬레이터를 시작하지 않았습니다.

## 운영 적용 결과

사용자가 배포를 승인한 뒤 같은 계획으로 운영 이관을 실행했습니다.

- 제품 commit: `744ecc5f594623c0329f97d11bce84076ea62508`
- 적용 계획: `3317321742b83b70acca050f940a74bc9d2f87e211ba062e603d54b7cb6f6f0a`
- 적용 결과: `written: 1068`, `alreadyApplied: 0`, `status: MATCH`
- 서버 배포 후 재대조: `mutations: 0`, `issueCounts: {}`
- 재대조 계획: `dd726415f7e777a74056582cdf61972a3434af3e9a3d5c357cdc4ae4e390c9af`
- Firebase release: `release-20260918-storage-consolidation-744ecc5`
- Firebase 세 Functions codebase와 Firestore Rules/index 배포 및 실제 로그인 smoke 성공. 배포 결과가 기록되고 lease가 해제됐습니다.
- Functions artifact SHA-256: `1fe51ede0aa262d650b029d683cbc7f8f6755567ff48949b8f800f114dc9d1c7`
- APK v1.2.28 SHA-256: `f752c3e77e989f45491f8487e0c5a743b033d054178301dabf51e7ff5be55c66`

기존 flat 원본은 보존했고 이후 업무 처리는 canonical만 갱신합니다. 서버 이후 Web은 해당 제품 commit을 포함한 main push의 Vercel Git 자동배포, APK는 해당 제품 commit을 target으로 한 v1.2.28 Release로 전달합니다. 원격 CI는 별도 확인하며 아직 실행되지 않은 CI를 통과로 기록하지 않습니다.

실제 기기에서는 Android 1.2.28 설치 후 앱을 열고, 이미 실행 중이었다면 최근 앱 목록에서 종료 후 다시 엽니다. Android는 별도 PWA 갱신이나 캐시/앱 데이터 삭제가 필요하지 않습니다. 아이폰 PWA도 새로 열고 새 버전 안내가 있으면 갱신합니다. 기기 설치·갱신 완료 여부는 서버 배포 성공과 구분합니다.

## 승인된 기존 원본 정리

후속 요청에서 사용자가 기존 원본 삭제를 명시적으로 승인했습니다. 삭제 대상은 위 표의
복구용 자료 3,418문서입니다. `assetSnapshots`, 배당·정기거래 원본, receipt·Outbox·감사이력은
포함하지 않습니다. 새 저장소의 업무 데이터도 수정하지 않습니다.

`functions/scripts/cleanup-consolidated-storage.mjs`는 삭제 전에 모든 원문·문서 경로·updateTime을
저장소 밖의 private JSON에 백업합니다. 백업 직렬화의 타입·값 왕복이 동일해야 하며, 기존
이관 검증기의 업무값 대조가 불일치 0·보강 필요 0이어야 계획을 생성합니다. 명시 경로만
삭제하며 recursive delete는 사용하지 않습니다. 첫 삭제 전 전체 revision, 각 transaction에서
원본·대상·보유종목의 상위 자산을 다시 검증합니다. 변경이 발견되면 중단하며 부분 완료 후
같은 계획의 재개는 이미 삭제한 원본을 건너뜁니다.

```powershell
node functions/scripts/cleanup-consolidated-storage.mjs --project household-account-6f300 --backup-file "$env:TEMP\household-storage-originals-backup-20260918.json"
node functions/scripts/cleanup-consolidated-storage.mjs --project household-account-6f300 --backup-file "$env:TEMP\household-storage-originals-backup-20260918.json" --apply --expected-plan-hash <검토한-hash>
```

기존 계획 파일을 덮어쓰지 않습니다. 백업은 원문 복구 자료이며, 이후 새 저장소에 발생한
변경을 과거 서버로 되돌리는 기능은 아닙니다. 운영 삭제는 아래 두 선행 조치 후 수행합니다.

- 구형 `expenses`로 소유가구를 역조회하던 Shortcut receipt purge 사전검사를 canonical
  원장으로 전환합니다. 본문에 transactionId가 없는 과거 문서도 가구별 문서 ID로 조회하고,
  다른 가구에 같은 ID가 존재하면 임의로 소유자를 정하지 않습니다.
- 원본 삭제·타입 보존·동시 변경 중단·부분 재개·상위 자산 누락에 대한 실제 Firestore
  통합 검사와, 단축어 수집/편집 및 다른 가구 링크 차단 E2E를 확인합니다.

최초 백업 계획 hash는 `f1e1d270058875de7cc00082b845890913bf65a92a90ae1f5435322527659402`이며,
원본 수는 거래 3,202, 자산 38, 주식 40, 코인 4, 카드 33, 규칙 44,
flat 카테고리 27, 가구별 카테고리 27, 기본분류 설정 3입니다. 계획 생성 시 정합성은 MATCH입니다.

## 후속 CI에서 확인한 검증 수정

이전 commit `974967d`의 CI `35333738518`에서 Functions/Web/Android 기본 검사는 성공했고,
Web E2E 3건과 Android 계측 4건이 실패했습니다. 성공으로 덮어쓰지 않습니다.

- 새 원장의 단축어 카드 표시 필드는 `cardDisplay`인데 테스트가 구형 `cardLastFour`를
  기대했습니다. 실제 저장값과 편집 화면에 표시되는 카드 정보를 함께 검사하도록 수정했습니다.
- 알림 링크는 현재 가구의 원장만 읽으므로 다른 가구의 ID도 없는 ID와 같은 안내를
  표시합니다. 타 가구 정보를 노출하지 않는 동일 오류 안내를 정확히 검사합니다.
- Android artifact의 화면과 logcat에서 앱 테스트 시작 전 Pixel Launcher ANR을 확인했습니다.
  APK 빌드를 에뮬레이터 부팅 전에 수행하고 HOME 창의 실제 입력 포커스를 확인한 뒤 검사합니다.
  앱의 ANR을 숨기거나 테스트 기대값·시간제한을 완화하지 않습니다.

## 후속 운영 적용 결과

- 제품 commit: `7d8f1f734d792606db90c4ed9fc7d82dc78f0425`
- Firebase release: `release-20260918-storage-followup-7d8f1f7`
- Functions 세 codebase와 Firestore index 배포, 실제 로그인 smoke 및 배포 기록 저장을 완료했습니다.
- 위 백업 계획으로 기존 원본 3,418문서를 삭제했고, 새 저장소 3,364문서의 보존을 검증했습니다.
- 삭제 후 재대조에서 기존 원본 0건, 추가 이관 0건, 불일치 0건을 확인했습니다.
  재대조 hash는 `88e731b83458c97c51dc0f68542f4c4d7e1a83b8adb5b6a5a1b9a55fcc715591`입니다.
- 삭제 후 실제 인증 조회에서 2026년 9월 원장 오름차순·내림차순 각각 134건,
  주식 13건, 코인 2건, 카테고리 12건을 정상 조회했습니다. 사용한 계정은 system-admin이며,
  일반 가구 구성원의 권한 검증과는 구분합니다.
- 원문 복구 백업 `household-storage-originals-backup-20260918.json`은 Git 밖의 private 경로에
  보존했습니다. 새 저장소에만 있던 감사 거래, receipt·Outbox 및 다른 업무 원본은 삭제하지 않았습니다.
- 실제 Firestore 통합 42개, 상태 요약 동시성 통합 2개와 관련 Web E2E 9개를 확인했습니다.
  최초 실패를 수정한 뒤 해당 검사만 재실행한 결과를 포함하며 전체 원격 CI 성공을 뜻하지 않습니다.

원격 CI `35336068255`의 Functions/Web/Android 기본 검사는 성공했습니다. Android 준비 검사는
Android 14의 `dumpsys window windows` 출력에 없는 포커스 필드를 찾던 도구 오류로 중단됐습니다.
포커스가 포함되는 `dumpsys window displays`로 수정하고 실제 실패 출력 기반 회귀를 추가했습니다.
앱 계측 테스트는 이 실행에서 시작되지 않았으므로 후속 CI에서 별도로 확인합니다.

같은 실행의 Web E2E는 93개 중 1개가 실패했습니다. 관리자 장애 복구 검사가 구형 실행
이력만 직접 준비하여 신규 요약이 없는 fixture 문제였습니다. 기존 scheduled helper로
실제 작업·상태 writer를 실행하고 COMPLETE 요약이 기록된 것을 확인하도록 변경했습니다.
OPEN 이력은 보존된 상태에서 복구된 장애가 화면에서 사라지는 기존 검증을 유지합니다.
수정 후 새 에뮬레이터에서 관리자 E2E 3개(Chromium)와 Android 준비 도구 회귀 4개를
통과했습니다. 원격 전체 CI는 후속 commit에서 별도로 실행합니다.
