# 배포 전 외부 설정 체크리스트

애플리케이션 코드와 로컬 테스트로 만들 수 없는 Firebase·Google Cloud 리소스만 관리합니다. 이 문서는 배포 승인이 아니며 운영 데이터 변경도 수행하지 않습니다.

준비가 끝난 후보의 manifest·정확한 HEAD의 CI·배포 잠금·smoke·provenance 검증은 [Firebase release 실행 절차](firebase-release-runbook.md)를 따릅니다.

## Web·Android 배포 순서

- Web은 연결된 GitHub 저장소의 `main`에 push하면 Vercel이 자동으로 빌드·배포합니다. 프로젝트 Root Directory는 `web`, Production Branch는 `main`을 유지하고 `git.deploymentEnabled=false`를 추가하지 않습니다. 배포 화면에는 Git 커밋 제목·SHA·브랜치가 자동으로 표시됩니다. [Vercel Git 자동배포](https://vercel.com/docs/git/vercel-for-github)를 따릅니다.
- Push 전에는 저장소에서 정한 품질 게이트와 변경한 화면의 테스트·프로덕션 빌드를 통과시킵니다. Push 후에는 같은 HEAD의 GitHub Actions 결과와 Vercel 자동배포 상태·운영 도메인 반영을 확인합니다. Git 자동배포가 시작되면 별도 CLI 배포를 중복 실행하지 않습니다.
- Android 에뮬레이터는 Android 코드·공용 계약·Android 연동 경로가 바뀔 때만 실행합니다. Web 글자·색상·배치·카테고리 UI만 바뀐 경우에는 이를 의무로 요구하지 않고 Web 테스트·빌드와 관련 모바일 브라우저 검증을 사용합니다. 정확한 경로는 [변경 범위 판정](../../tools/ci/android-instrumentation-scope.mjs)을 따릅니다. 에뮬레이터 설정 자체를 검증해야 하는 경우 Actions의 수동 실행으로 전체 검증을 수행할 수 있습니다.
- Git 자동배포는 커밋된 소스를 사용합니다. 로컬 서명 파일·환경 파일은 Git에 추가하지 않습니다. 수동 CLI 배포가 별도로 필요한 경우에도 작업 디렉터리 전체를 업로드하지 않습니다. `git -c core.autocrlf=false archive --format=zip --output=<저장소 밖 후보.zip> HEAD web contracts .vercelignore`로 **검증된 커밋의 추적 소스만** 별도 디렉터리에 준비합니다. 루트 `.vercelignore`의 환경·서명·빌드 파일 제외 규칙을 유지합니다. [Vercel 업로드 제외 규칙](https://vercel.com/docs/deployments/vercel-ignore)을 따릅니다.
- Android는 같은 CI 성공 확인 후 서명된 release APK를 GitHub Releases에 올립니다. 버전·서명·태그는 프로젝트의 `github-release-deploy` 스킬을 따릅니다.

## App Check

- Android 앱을 Firebase App Check의 Play Integrity 공급자에 등록하고 배포 인증서 SHA-256을 등록합니다.
- Play Console에서 같은 Google Cloud 프로젝트에 Play Integrity API를 연결합니다.
- Android 앱의 Play Integrity App Check 요청 지표를 확인한 뒤 Native 결제 수집·세션 callable을 배포합니다. Android WebView와 iPhone 홈 화면 PWA의 공용 Command·Query는 Firebase Auth·활성 Membership으로 인가하며 Web reCAPTCHA App Check 설정을 요구하지 않습니다. Shortcut HTTP endpoint는 사용자별 Bearer credential로 인증합니다.

## Google 로그인

- Android Firebase 앱에 debug·release SHA-1과 SHA-256을 모두 등록합니다.
- 갱신된 `google-services.json`에 OAuth client가 포함됐는지 확인합니다.
- `GOOGLE_WEB_CLIENT_ID`를 Android 빌드 입력으로 제공합니다.

## 시스템 관리자 claim

관리자 화면은 이메일이나 클라이언트 payload를 권한 근거로 사용하지 않고, Firebase가 검증한 ID token의 `systemAdmin: true` custom claim만 신뢰합니다. Application Default Credentials가 있는 운영자 환경에서 먼저 dry-run 결과의 project와 UID hash를 확인한 뒤에만 `--apply`를 사용합니다.

```powershell
cd functions
node scripts/set-system-admin-claim.mjs `
  --project household-account-6f300 `
  --uid FIREBASE_AUTH_UID `
  --enable

# 검토 후 같은 명령에 --apply 추가
```

권한을 회수할 때는 `--disable --apply`를 사용합니다. 변경 후 기존 ID token에는 이전 claim이 남아 있으므로 해당 사용자는 로그아웃 후 다시 로그인하거나 ID token을 강제 갱신해야 합니다. 이 도구는 다른 custom claim을 보존하고 UID 원문을 출력하지 않습니다.

## Cloud Monitoring 이메일 경보

1. Cloud Monitoring에서 이메일 notification channel을 한 번 생성하고 검증합니다. 이메일 주소는 애플리케이션 코드나 Firestore에 저장하지 않습니다.
2. channel의 전체 resource name을 확인합니다.
3. Functions 배포 환경의 `CLOUD_MONITORING_NOTIFICATION_CHANNEL`에도 같은 전체 resource name을 설정합니다. 이 값은 이메일 주소가 아닌 Cloud Monitoring resource reference이며 배당·시세 Provider가 공통으로 사용합니다.
4. 아래 명령을 먼저 dry-run하고, 출력과 생성될 정책 JSON을 검토한 뒤에만 `-Apply`를 붙입니다.

```powershell
.\tools\operations\configure-cloud-monitoring.ps1 `
  -ProjectId household-account-6f300 `
  -NotificationChannelResource projects/household-account-6f300/notificationChannels/CHANNEL_ID
```

이 설정은 Provider 장애, 예약 작업 `MISSING/OVERDUE`, 매시간 실행되는 감시기 자체의 2시간 10분 heartbeat 부재를 감지합니다. 경보 정책은 incident 종료 알림도 켭니다.

## Shortcut

- 반자동 설치에 사용할 검증된 iCloud Shortcut 템플릿 URL을 서버 환경 설정으로 제공합니다.
- 발급용 credential 서명·해시 key version은 Secret Manager에서 관리하고 원문을 환경 파일·로그·Firestore에 두지 않습니다.
- 설치 화면에서 원문은 최초 발급 응답에만 표시되며, 응답을 잃은 사용자는 기존 키 조회가 아니라 명시적 재발급을 사용합니다.

## 종목 카탈로그 Storage CORS

- `market-catalog/v1/**`는 공개 시장 기준정보이므로 `storage.rules`에서 읽기만 공개하고 쓰기는 거부합니다.
- Web의 기기 카탈로그 동기화를 위해 버킷 CORS를 루트 [storage.cors.json](../../storage.cors.json)과 일치시킵니다. 허용 범위는 `GET`·`HEAD`뿐입니다.
- 새 Firebase 프로젝트나 Storage 버킷으로 이전할 때는 Rules 배포와 별도로 CORS 설정을 적용해야 합니다. Firebase CLI의 `deploy --only storage`는 Storage Rules만 배포하며 버킷 CORS를 적용하지 않습니다.
- 적용 뒤 Web Origin을 붙인 manifest 요청에 `Access-Control-Allow-Origin`이 반환되는지 확인합니다.

## 배포 직전 확인

- Functions, Web, Android 품질 게이트와 Firestore Emulator 테스트가 모두 통과해야 합니다.
- `firestore.indexes.json`, `firestore.rules`, `storage.rules`, `storage.cors.json`을 함께 검토합니다.
- 기존 사용자 legacy claim reconciliation을 먼저 수행하고, canonical·legacy 결과가 일치하기 전에는 compatibility reader와 flat collection을 제거하지 않습니다.

운영 전환은 다음 순서를 바꾸지 않습니다.

1. 품질 게이트와 Emulator suite를 통과시킵니다.
2. Functions·Rules·index·Storage Rules를 배포하되 아직 legacy reader를 제거하지 않습니다.
3. [런타임 데이터 전환 Runbook](runtime-migration-runbook.md)의 읽기 전용 계획을 생성하고 충돌·수동 연결 대상을 검토합니다.
4. [Firestore TTL 전환 Runbook](firestore-ttl-backfill.md)의 dry-run에서 잘못된 날짜가 없고 대상 수량이 예상과 일치하는지 검토합니다.
5. 별도 승인을 받은 계획만 plan hash와 프로젝트 재확인 값을 붙여 적용합니다.
6. 아래 reconciliation이 가구별 `MATCH`인지 확인한 뒤에만 compatibility reader 제거를 별도 변경으로 진행합니다.

각 도구는 기본적으로 읽기 전용이며, `--apply`가 필요한 단계는 코드 배포와 같은 승인으로 간주하지 않습니다. 실제 데이터 전환과 TTL 백필에는 각각 별도의 운영 승인이 필요합니다.

### 읽기 전용 런타임 reconciliation

Application Default Credentials가 설정된 운영자 환경에서 가구별로 아래 명령을 실행합니다. 이 도구는 Firestore read만 수행하고, 가구 ID 원문이나 개별 문서 내용 대신 count와 결정적 SHA-256 요약만 출력합니다.

```powershell
cd functions
npm run reconcile:runtime -- `
  --project household-account-6f300 `
  --household HOUSEHOLD_ID
```

`ledger`, `assets`, `categories`, `recurring`, `positions`가 모두 `MATCH`인 가구만 해당 compatibility reader 제거 후보가 됩니다. `MISMATCH`이면 종료 코드 2를 반환하며 자동 backfill이나 추정 귀속은 수행하지 않습니다.
