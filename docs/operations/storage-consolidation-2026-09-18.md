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
