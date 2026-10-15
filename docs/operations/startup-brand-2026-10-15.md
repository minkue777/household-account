# 승인한 로고·시작 화면 적용

이 문서는 v2.0.0까지의 최초 적용 기록입니다. 사용자 후속 요청의 아이콘 배경·화면 맞춤·최소 표시는 [v2.0.1 수정 기록](startup-brand-fit-2026-10-15.md)을 따릅니다.

## 요구사항과 범위

사용자가 제공한 첫 번째 세로 이미지를 시작 로딩 화면으로, 두 번째 정사각 이미지를 앱 아이콘으로 사용합니다. 이미지의 로고·색·문구는 다시 그리거나 바꾸지 않습니다. 앞서 생성한 로고 시안은 적용 대상이 아닙니다.

- 입력: 앱 실행·인증 확인·첫 홈 데이터 대기와 승인한 이미지 두 장.
- 결과: 같은 브랜드 화면에서 인증과 필수 데이터 준비를 기다린 뒤 완성된 홈으로 전환합니다. 이미지는 비율을 유지해 문구가 잘리지 않도록 화면 안에 맞춥니다.
- 실패: 기존 인증 오류·첫 홈 20초 제한·재시도 화면을 그대로 표시합니다. 이미지 표시를 위한 최소 대기 시간이나 새로운 준비 상태를 만들지 않습니다.
- 저장: 업무 데이터·인증·첫 홈 조회 계약은 변경하지 않습니다. 이미지와 플랫폼별 앱 아이콘만 정적 자산으로 포함합니다.

## 상세 설계

Web은 `HouseholdGuard`와 `LedgerPage`의 공용 `AppLoadingScreen`을 교체합니다. 서버 HTML에도 같은 화면을 렌더하고, 시작 이미지를 우선 로드합니다. 접근성 로딩 안내는 유지하며 배경은 사용자 테마와 독립적입니다. 원장·카테고리·지역화폐·홈 설정·필요 연간 합계의 준비 조건과 실제 paint 계측은 유지합니다. 한번 표시한 같은 가구의 갱신에는 브랜드 화면으로 되돌아가지 않습니다.

Android는 네이티브 초기 화면에서 동일한 이미지로 WebView의 첫 콘텐츠 표시까지 연결합니다. `onPageCommitVisible`은 하위 이미지 표시를 보장하지 않으므로 `onPageFinished` 뒤 `postVisualStateCallback`에서 내립니다. 이후 Web의 동일 화면이 기존 인증·홈 준비 계약을 소유합니다. 별도 home-ready 브리지나 지연을 추가하지 않으며 권한 안내·메인 문서 오류에서는 즉시 이미지를 내려 해당 화면을 가리지 않습니다. 앱 아이콘은 원본을 플랫폼별 해상도로 리샘플링하고 Web 아이콘은 새 경로를 사용해 기존 캐시와 구분합니다.

## 검증과 추적성

| 계약 | 검증 |
|---|---|
| LED-001 / T-LED-001 / HOME-003 | `homeFirstCompletePaint.contract.test.tsx`: 인증→데이터 대기 연속성, 마지막 결과, 실패·재시도, 갱신 보존 |
| T-WEBVIEW-004 | 실제 Emulator·production build·WebKit의 마지막 잔액 보류 검사: 이미지 디코딩·화면 배치·직접 홈 전환 |
| T-WEBVIEW-004 | 실제 WebKit 무응답→오류→최신 값 재시도: 브랜드 화면이 오류 처리를 막지 않음 |
| AND-003 / T-WEBVIEW-004 | 실제 Activity/WebView 검사: 시작 이미지 요청 보류 중 네이티브 화면 유지, 이미지 준비·draw 뒤 전환, HTTP 503·권한·복귀·재생성·renderer 복구 |

검증·배포 결과는 확인 후 아래에 기록합니다. Web은 Vercel Git 자동배포, Android는 새 서명 APK 배포 대상이며 Firebase 실행 코드는 변경하지 않습니다.

## 로컬 검증

- Web 첫 홈 계약 19개 통과. Functions architecture 43개와 production Web build 통과.
- 실제 Firebase Emulator·iPhone WebKit 검사에서 브랜드 이미지 decode, 모바일·PC 배치, 마지막 잔액 응답까지 대기 후 직접 홈 전환, 20초 무응답 오류·재시도와 구독 전환을 확인했습니다.
- Android unit 156개, API 36.1 실제 MainActivity instrumentation 19개 통과. 기존 테스트의 실행 중 `POST_NOTIFICATIONS` 회수가 테스트 프로세스를 종료한 첫 실행은 실패 이력으로 남겼습니다. 설치 후 instrumentation 시작 전에 권한을 회수하고 동일한 전체 19개를 검증했습니다.
- WebKit 첫 실행은 4 passed/1 failed입니다. 기존 지연 코드 준비 검사에서 request 이벤트 뒤 Resource Timing을 너무 일찍 읽어 `requests=[]`를 관찰했습니다. trace에서 해당 세 파일 요청이 assertion 전에 시작됐지만 응답 완료는 assertion 뒤였음을 확인했습니다. 완료 관측 후 기존 첫 paint 이후 요청 순서 검증을 유지하도록 보강한 뒤 해당 검사 1 passed(36.5초)입니다. 날짜 재선택·추가·검색·코드 실패 재시도·저장 검증도 유지했습니다.
- production 서버 HTML의 이미지 preload와 접근성 status를 확인했고, 요구사항 catalog check도 통과했습니다.
- 로그: `TEMP/household-startup-brand-{prepare,web-e2e,release}-20261015.log`, `TEMP/household-brand-android-mainactivity-20261015.log`.
- 관측 보강 로그와 최초 실패 trace: `TEMP/household-startup-brand-preload-observation-20261015.log`, `TEMP/household-startup-brand-preload-observation-20261015-trace.zip`.

## 배포 산출물

- Android v1.2.35 / versionCode 37의 release build와 APK v2 서명을 확인했습니다. APK 크기는 10,821,907바이트, SHA-256은 `e8ed348c8485c019ef5a3e96f337611e108b390926bd47d8a8f08e5430bc2084`입니다. 기존 공개 버전은 덮어쓰지 않습니다.
- 운영 Web은 이 변경을 포함한 SHA의 Git 자동배포를 확인합니다. `/_next/static/media/startup-brand.1473839b.jpg`를 서버 HTML에서 우선 preload하며 앱 아이콘은 `/icons/household-v1-{192,512,apple-touch}.png`입니다.
- Firebase 변경은 없어 배포하지 않습니다. 전체 CI는 push SHA를 기준으로 별도 후속 확인합니다.

## 2.0.x 버전 전환

사용자 요청에 따라 이후 앱 릴리즈는 2.0.x로 이어갑니다. 첫 버전은 v2.0.0 / versionCode 38이며, 승인한 시작 화면·아이콘을 포함합니다. 이미 공개된 v1.2.35를 덮어쓰지 않고 새 버전으로 배포합니다. 앱 ID·서명·저장 형식·API 계약은 그대로여서 기존 앱 위에 업데이트할 수 있습니다.

release build와 APK v2 서명을 확인했으며 이전 v1.2.35와 서명 인증서가 같습니다. APK 크기는 10,821,899바이트, SHA-256은 `9a099caba13b3065092d827d71eb87e9d93fd6e0ac31282b1709121bd2fc4ec8`입니다. 버전 표시는 Native versionName을 그대로 사용하며 1.x 고정 로직이 없습니다. 빌드 로그는 `TEMP/household-v2-release-20261015.log`입니다.

시작 화면 구현 `5ea875c55196660258eba26e49f3e7c52ef2d75c`의 Vercel Git 배포와 운영 HTML·Service Worker SHA, 이미지·아이콘 HTTP 200·로컬 파일 hash 일치를 확인했습니다. 버전 전환은 Android 빌드 설정과 이 기록만 변경하며 Web·Firebase 재배포는 필요하지 않습니다.
