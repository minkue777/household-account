# 로컬 대화형 지연 계측

## 목적

첫 화면과 Android 결제 자동 등록의 지연을 감으로 비교하지 않고 동일한 단계로 반복 측정합니다. 로컬 계측은 코드 구간의 병목을 찾는 용도이며, Google 인프라의 실제 cold start·App Check·모바일 통신망 시간은 배포 후 같은 필드로 별도 확인합니다.

로그와 Performance entry에는 UID, householdId, memberId, 거래 ID, 금액, 가맹점, 알림 원문을 넣지 않습니다. Android와 Functions를 연결할 때만 `SHA-256(observationId)`의 앞 16자리인 `correlationId`를 사용합니다.

## Web 첫 화면

개발 서버는 HMR과 개발용 검사를 포함하므로 체감 속도 비교에 사용하지 않습니다. `web` 디렉터리에서 production 빌드를 로컬로 실행합니다.

```powershell
npm run build
$env:PORT=3102
npm start
```

브라우저 개발자 도구의 Console에서 아래 식을 실행합니다.

```js
performance.getEntriesByType('measure')
  .filter(({ name }) => name.startsWith('household-account:startup:'))
  .map(({ name, duration }) => ({ name, durationMs: Math.round(duration) }))
```

위 measure는 앱 모듈이 평가된 뒤의 업무 구간을 나눕니다. 정적 JS 다운로드와 파싱까지 포함한 실제 첫 화면 시간은 Navigation Timing에서 원장 첫 paint mark까지 별도로 확인합니다.

```js
const navigation = performance.getEntriesByType('navigation')[0]
const firstLedgerPaint = performance.getEntriesByName(
  'household-account:startup:ledger:first-paint',
  'mark'
)[0]

({
  navigationToFirstLedgerPaintMs: Math.round(firstLedgerPaint.startTime),
  responseEndToFirstLedgerPaintMs: Math.round(
    firstLedgerPaint.startTime - navigation.responseEnd
  ),
  transferredBytes: navigation.transferSize,
})
```

cache hit 여부는 아래 식으로 확인합니다.

```js
performance.getEntriesByType('mark')
  .filter(({ name }) => name.startsWith('household-account:startup:'))
  .map(({ name }) => name)
```

핵심 measure는 다음과 같습니다.

| measure | 의미 |
| --- | --- |
| `navigationToFirstLedgerPaintMs` | 탐색 시작부터 사용 가능한 원장 화면이 실제 paint될 때까지. JS 다운로드·파싱 포함 |
| `household-account:startup:duration:first-ledger-paint` | HouseholdContext 모듈 평가 뒤부터 원장 paint까지. 업무 bootstrap 구간 분리용 |
| `household-account:startup:duration:auth` | Firebase Auth 복원 |
| `household-account:startup:duration:membership` | cache를 쓰지 않은 Membership 권위 조회 |
| `household-account:startup:duration:household` | 가구 read model 권위 조회 |

`membership-cache:hit`, `household-cache:hit`, `ledger-cache:hit`가 있으면 해당 화면은 로컬 표시 hint를 사용한 것입니다. 새 탭의 첫 실행, 완전 종료 뒤 재실행, localStorage 삭제 뒤 실행을 구분하여 각각 최소 10회 기록합니다. DevTools의 Disable cache는 정적 리소스 실험에만 사용하고 화면 snapshot cache 실험과 섞지 않습니다.

Android 실제 단말의 WebView는 debug APK에서만 원격 디버깅을 허용합니다. USB 디버깅으로 단말을 연결하고 PC Chrome의 `chrome://inspect/#devices`에서 가계부 WebView를 선택한 뒤 같은 Console 식을 실행합니다. release APK에서는 이 경로를 열지 않습니다. iPhone PWA는 Mac의 Safari Web Inspector가 있어야 같은 방식으로 확인할 수 있으므로, Windows 로컬 계측만으로 iPhone 실기기 결과를 대신하지 않습니다.

## Functions 단계별 처리

프로젝트 루트에서 다음 명령으로 빌드한 뒤 Functions와 Firestore를 모두 로컬 에뮬레이터로 실행합니다. 운영 Firestore를 실수로 사용하지 않도록 측정용 demo project ID를 고정합니다.

```powershell
npm --prefix functions run build
firebase --config firebase.json emulators:start --only functions,firestore --project demo-household-account-latency
```

현재 Web과 Android 런타임에는 Auth·Functions emulator 연결 설정과 측정용 데이터 seed가 없습니다. 따라서 위 명령은 Functions가 빌드되고 뜨는지 확인하고, 단위·adapter 테스트에서 단계별 계측을 검증하는 용도입니다. **현재 운영 Web/Android를 demo emulator에 직접 연결해 실제 요청을 재생하는 단일 명령은 아직 제공하지 않습니다.** 일반 `web npm run dev`는 운영 Firebase를 사용하므로 Functions 로컬 에뮬레이터 계측과 혼동하지 않습니다. 배포 전 실제 Firestore 왕복까지 재현하려면 별도 Auth emulator·seed·benchmark client가 필요합니다.

주요 단계는 다음과 같습니다.

- Command: `actor-membership`, `command-receipt-claim`, `handler`, `command-receipt-complete`, `total`
- Query: `actor-membership`, `handler`, `total`
- Android capture: `capture-membership`, `capture-receipt-claim`, `capture-configuration`, `capture-persistence`, `capture-receipt-save`, `handler`, `total`

같은 `correlationId`, `processBootId`, `invocationSequence`, `revision`, `operation`끼리 묶어 봅니다. 에뮬레이터는 업무 코드와 Firestore 호출 구간을 비교할 수 있지만 Cloud Functions 컨테이너 생성 시간과 실제 모바일 왕복 시간은 재현하지 않습니다.

## Android 알림부터 Quick Edit까지

디버그 APK는 상세 로그가 항상 켜져 있습니다. 설치한 뒤 다음 명령으로 해당 tag만 봅니다.

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb logcat -v monotonic 'HHCaptureLatency:D' '*:S'
```

측정 단계는 다음과 같습니다.

- `notification_received`
- `journal_persisted`
- `callable_start`
- `callable_end`
- `follow_up_persisted`
- `quick_edit_launch`
- `quick_edit_shown`

같은 process가 유지되면 마지막 요약 줄에 `notificationToJournalMs`, `callableMs`, `callableEndToFollowUpMs`, `followUpToLaunchMs`, `launchToShownMs`, `totalMs`가 기록됩니다. `correlationId`가 같은 Functions 로그와 합치면 모바일 전후 처리와 서버 내부 처리의 비중을 분리할 수 있습니다. 중간에 Android process가 종료되면 영속 queue는 복구되지만 이전 timestamp는 메모리에만 있었으므로 전체 `totalMs`가 남지 않을 수 있습니다. 재시도가 있었다면 `callableMs`는 마지막 시도를 뜻합니다.

release APK는 기본적으로 상세 단계 로그를 남기지 않고 요약만 기록합니다.

## 비교 원칙

- cold와 warm, cache hit와 miss, WebView와 브라우저를 섞어 평균내지 않습니다.
- 각 구간은 중앙값과 p95를 함께 기록합니다.
- Functions는 `revision`과 `operation`별로 나눕니다.
- 첫 화면 목표는 `first-ledger-paint`, Android 목표는 `totalMs`로 판단합니다.
- 로컬 개선이 확인되어도 운영 배포 전후에 같은 표본 조건으로 다시 확인합니다.
