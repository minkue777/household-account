# 시작 화면 맞춤·최소 표시와 아이콘 배경 수정

> 현재 변경은 아래 v2.0.5 후속 절의 그림·선택 가구명·부제 분리입니다. 배경은 사용자 참조색 `#F5F2FD`이며 앞선 검증·배포 이력은 보존합니다. v2.0.5 검증·배포 결과는 실제 확인 후 기록합니다.

## 원인과 계약

- 아이콘은 원본에 흰색 둥근 사각 타일이 들어 있고 Android adaptive icon이 바깥 모양을 다시 씌워 이중 배경으로 보였습니다. 지갑·사람 카드·동전 그림을 보존하면서 원본 타일을 제거합니다. Android는 투명 foreground와 단일 배경을, Web/iOS는 단일 평면 배경을 사용합니다.
- 시작 화면의 720×1280 원본을 긴 휴대폰에 contain/fitCenter로 맞추면서 위아래에 단색 여백이 생겼습니다. 실제 Android 1080×2400 캡처에서 본문 잘림이 아니라 이미지와 여백의 경계임을 확인했습니다. 표시 영역 비율 3:8~9:16은 cover/centerCrop으로 좌우 배경만 잘라 상하를 채우고, 가로·데스크톱·범위 밖 비율은 전체 시안을 유지합니다. 제목·부제·하단 점의 중앙 영역은 보존합니다.
- 후속으로 사용자가 제공한 `1000017849.jpg` 시안으로 교체하고 하단 ‘함께 만드는, 더 든든한 오늘’ 문구만 삭제했습니다. 지갑 그림·제목 ‘또니망고네’·부제 ‘가계부 · 자산’·점 세 개는 유지합니다.
- 사용자가 너무 빨리 사라지지 않도록 요청하여 Web 문서당 1.2초 최소 표시를 적용합니다. `StartupDisplayProvider`의 타이머 하나를 인증·홈 조회와 함께 시작하고 홈에서는 서버 자료 준비와 최소 표시가 모두 끝났을 때만 화면과 paint 계측을 완료합니다. 인증→홈 전환과 내부 route 이동은 타이머를 다시 시작하지 않습니다. 느린 자료 뒤에 1.2초를 더하지 않습니다. 인증·조회 오류와 재시도는 남은 최소시간을 기다리지 않습니다.
- 입력은 앱 시작·인증/조회 결과·화면 크기·승인한 시안입니다. 결과는 단일 모양의 아이콘과 빈 띠 없는 세로 시작 화면입니다. 저장·권한·멱등성·업무 조회 계약은 바꾸지 않으며 네이티브 별도 타이머나 준비 Bridge를 추가하지 않습니다.

## 캐치테이블 확인

같은 PC의 `../catchtable`을 읽기 전용으로 확인했습니다. `web/react/startup-screen.tsx`는 데이터·폰트 준비 후 다음 frame에 content-ready를 전달합니다. `web/styles/startup.css`와 Android `StartupHandoff.kt`에는 180ms fade가 있지만 최소 표시시간은 없습니다. Web의 240ms는 transitionend 유실 시 종료 보조이며 최소 노출 정책이 아닙니다. 캐치테이블 코드는 변경하지 않았습니다.

## 이미지 산출물

내장 imagegen의 background-extraction으로 원본 사각 타일·그림자·바깥 배경만 제거하고 지갑·카드·동전·색·구도를 보존하도록 요청했습니다. 최종 투명 원본은 `web/src/assets/brand-icon-foreground.png`입니다. 출력 프롬프트의 핵심은 “Remove ONLY the entire white rounded-square tile, its shadow, and the pale lavender outer background. Preserve the blue wallet, three person cards, accent rays and yellow coins. Actual transparent RGBA; no tile/frame/border.”입니다. 플랫폼용 크기 변경과 단일 배경 합성은 결정적인 리샘플링으로 수행합니다.

Android adaptive foreground의 alpha를 유지하고 density별 아이콘과 Web `/icons/household-v2-{192,512,apple-touch}.png`를 생성했습니다. 기존 v1 URL은 이미 설치된 앱의 캐시 호환을 위해 보존합니다.

시작 화면도 내장 imagegen으로 편집했습니다. 프롬프트는 “Remove ONLY the small Korean slogan near the bottom, '함께 만드는, 더 든든한 오늘'. Seamlessly fill that text region with the surrounding pale lavender/white gradient. Preserve the exact wallet/cards/coins illustration, Korean brand title '또니망고네', subtitle '가계부 · 자산', three colored dots, composition and boundaries.”입니다. 결과를 720×1280 JPEG로 변환한 `web/src/assets/startup-brand.jpg`와 `android/app/src/main/res/drawable-nodpi/startup_brand.jpg`는 동일한 45,702바이트 파일입니다.

## 검증·추적성

| 계약 | 검증 |
|---|---|
| LED-001 / T-LED-001 | 빠른 인증→홈도 최초 1.2초 유지, 느린 조회는 추가 대기 없음, 오류 즉시 표시, 실제 표시 후 paint |
| AND-003 / T-WEBVIEW-004 | 실제 Android 이미지 요청 보류 중 시작 화면, 세로 상하 채움·중앙 문구 영역 보존, 가로 전체 시안, HTTP 오류·권한·복귀 |
| T-WEBVIEW-004 | 실제 Firebase Emulator·production WebKit의 세로·가로·PC 이미지 배치와 마지막 서버 응답 후 표시, 최초 표시 계측 |

Web 관련 단위 계약 2개 파일 31개가 통과했습니다(홈 22개, 공통 Guard 9개). 기존 성능 리포트는 전체 표시 시간을 그대로 기록하므로 이번 의도적 최소 노출이 포함됩니다. 조회 준비 단계 시각과 실제 paint를 구분하며 기존 수치나 과거 결과에서 최소시간을 빼지 않습니다.

실제 Firebase Emulator·production build·WebKit 첫 홈 계약 5개를 확인했습니다. 오류·재시도·지연 응답·최소 표시 4개가 통과했고, 최종 시안의 배치·마지막 응답 검사 1개도 통과했습니다(테스트 14.0초). 390×844·360×960은 상하를 채우고 844×390·1280×800은 전체 그림을 보존합니다. 제목·부제·하단 점과 삭제된 문구를 4장 캡처로 확인했습니다. WebKit의 1/64 CSS px 반올림과 가로 회전 시 스크롤바 너비를 관측에 반영하되 실제 fixed 영역 채움·내용 보존·기존 20초 실패 기준은 유지했습니다. 최종 로그는 `%TEMP%/household-startup-brand-final-geometry-e2e-20261015.log`입니다.

Android 실제 MainActivity 19개가 통과했고, 새 시안·문구 삭제 후 해당 레이아웃 검사 1개를 다시 통과했습니다. 최종 세로·가로 캡처와 실제 런처 아이콘을 육안으로 확인했습니다. 세로 화면에는 상하 단색 띠가 없고 가로 화면은 전체 그림을 보존합니다. 인증된 비홈 경로 직접 진입에도 최소시간을 적용하되, 홈 두 경로(`/`, `/income`)는 즉시 mount하여 조회를 병렬 진행합니다. 비홈 페이지는 최소시간 후 진입합니다.

서명 release build는 통과했으며 v2.0.1 / code 39 / 10,812,359바이트입니다. APK SHA-256은 `e4710d786a567fd639ecb2917cdc56e00e2466d30edf05b00d55c95e49fdb530`이고 apksigner v2 검증과 v2.0.0의 동일 서명 인증서 확인을 마쳤습니다. 로그는 `%TEMP%/household-v2.0.1-release-20261015.log`, 최종 Android 레이아웃 로그는 `%TEMP%/household-brand-final-capture-20261015.log`입니다.

### 이전 CI 실패와 후속 검사

- `38695840611`과 `38696327908`의 Android 검사는 각각 48개 중 새 시작 이미지 검사 1개가 실패했습니다. 리소스 요청이 왔다는 사실만으로 DOM 이미지 생성까지 완료됐다고 가정한 관측 경합입니다. 후자의 logcat은 `document.images[0].complete`에서 `Cannot read properties of undefined (reading 'complete')`를 기록했습니다. DOM 이미지가 생성될 때까지 확인한 뒤 기존 `complete === false`·네이티브 화면 유지·이미지 준비 후 해제 검증을 수행하도록 보강했습니다. 수정 후 API 36.1의 실제 MainActivity 검사 19개가 통과했습니다.
- `38696327908`의 Functions는 카드 등록 경합 검사만 기본 5초를 초과했습니다(150/151 통과). 해당 구간의 Firestore Emulator 로그에 query/commit 잠금 timeout과 닫힌 transaction 오류가 있으나 최초 RPC 오류·운영 재현 여부는 미확정입니다. 제품 저장 코드는 변경하지 않고 두 실제 transaction이 같은 초기 상태에서 등록을 준비한 뒤 commit하도록 검사 순서를 고정했습니다. 실제 SDK 재시도와 최초 두 등록 후보를 추가 검증하며, 최종 성공 1건·중복 거부 1건·카드/claim 1개·재전송 결과와 5초 제한을 유지했습니다. 실패 시 시도 수·후보 결과·SDK 로그를 남깁니다. 이는 임의의 query/commit 교차 경합이 제품에서 해결됐다는 뜻이 아닙니다.
- 후속 카드 저장 검사는 실제 Firestore Emulator 3개가 통과했습니다(등록 경합 3,639ms, 수정 경합 3,586ms). Functions 타입 검사도 통과했습니다. 로그는 `%TEMP%/household-startup-card-race-20261015.log`와 `household-startup-card-race-types-20261015.log`입니다.
- 이전 두 실행의 `web-e2e`는 모두 success로 완료되어 새 Web 실패는 없습니다. `38696327908`의 전체 결과와 요약은 위 두 실패로 failure이며, 후속 로컬 통과를 이전 CI 성공으로 바꾸어 기록하지 않습니다.

## 배포 범위

Android v2.0.1 / versionCode 39와 Web Git 자동배포 대상입니다. Firebase 실행 코드는 변경하지 않습니다. 기존 v2.0.0 APK는 덮어쓰지 않습니다. 실제 검증·배포 결과는 확인 후 기록합니다.

## v2.0.2 후속: 시작 화면·아이콘 단색 배경

사용자가 그라데이션 대신 단색 배경을 요청한 뒤 `1000017850.jpg`를 색상 기준으로 지정했습니다. 빈 배경의 대표 RGB는 `(245, 242, 253)`이므로 `#F5F2FD`로 통일합니다. 시작 화면 JPEG·Web 로딩 요소·PWA 시작 배경·Android 시작 이미지 배경·adaptive/legacy 앱 아이콘·Web/iOS 아이콘에 같은 색을 사용합니다. 지갑·제목·부제·하단 점의 배치, 삭제한 슬로건, 문서당 최소 1.2초 정책은 유지합니다.

내장 imagegen으로 배경만 투명 분리했습니다. 프롬프트 핵심은 “Remove the entire gradient background, making it fully transparent. Preserve all foreground in its exact placement and scale: wallet/cards/coins, '또니망고네', '가계부 · 자산', three dots. Keep full 9:16 canvas, no trimming/repositioning, no deleted slogan.”입니다. 투명 원본은 `web/src/assets/startup-brand-foreground.png`, 동일한 단색 합성 결과는 `web/src/assets/startup-brand.jpg`와 Android `drawable-nodpi/startup_brand.jpg`입니다. JPEG 네 모서리의 실제 디코딩 값도 `(245, 242, 253)`으로 확인했습니다(720×1280, 36,955바이트).

기존 투명 아이콘 원본으로 동일 크기·배치를 유지하여 배경만 합성합니다. 새 Web URL은 `/icons/household-v3-{192,512,apple-touch}.png`이며 기존 v1/v2 파일은 설치된 앱의 캐시 호환을 위해 보존합니다. Android는 v2.0.2 / code 40으로 발행하며 이미 공개·다운로드·서명 확인한 v2.0.1을 덮어쓰지 않습니다.

v2.0.1의 `f53039ade9d904dfdfe93d9af063ebc978f389bb`는 Vercel Git 배포와 Production `7086677858` 성공, 운영 root·sw·해당 SHA buildManifest HTTP 200을 확인했습니다. CI `38699457238`의 미완료 결과는 후속 후보와 함께 확인하며, 새 버전 공개가 이전 실제 Android 검사를 대체하지 않습니다.

최종 색상으로 실제 Android 시작 이미지 검사 1개가 통과했습니다(10.809초). 세로·가로 캡처에서 이미지 안팎이 동일한 단색이고 로고·제목·하단 점이 보존됨을 확인했습니다. 서명 release build 통과, v2.0.2/code40, 10,803,595바이트, SHA-256 `d5c587c955b471ae70794fd2c17b1bd8ce738b8f909f3ed8e42d42b6d009b3e8`입니다. apksigner v2 검증과 기존 인증서 일치를 확인했습니다. 로그는 `%TEMP%/household-brand-color-capture-20261015.log`, `household-v2.0.2-release-20261015.log`입니다.

Web도 최종 리소스로 production build·실제 Emulator WebKit 기존 레이아웃/마지막 잔액 검사 1개를 통과했습니다(테스트 14.1초). 4종 화면의 16개 모서리 모두 RGB `(245, 242, 253)`으로 일치하고 중앙 내용 보존을 육안 확인했습니다. 기능 코드는 바꾸지 않아 앞선 단위 계약을 재반복하지 않았습니다. 로그는 `%TEMP%/household-startup-brand-v202-layout-e2e-20261015.log`입니다.

## v2.0.3 후속: 과도한 확대와 압축 선명도 개선

사용자가 로딩 이미지가 크고 깨져 보인다고 보고했습니다. 720×1280 JPEG를 긴 휴대폰 높이에 맞춰 cover/centerCrop으로 확대하면서 고밀도 화면의 물리 픽셀보다 부족한 원본을 늘렸습니다. 배경은 이미 단색이므로 화면을 이미지로 채울 필요가 없습니다.

모든 비율에서 Web `contain + 24px padding`, Android 기본 `ImageView fitCenter + 24dp padding`으로 통일합니다. 비율별 cover CSS와 전용 `StartupArtworkView`를 제거합니다. 390×844 화면 기준 로고의 폭은 약 28% 작아지며 전체 시안은 보존합니다. 단색 배경·아이콘·하단 문구 삭제·최소 1.2초·준비/오류/계측 계약은 유지합니다.

새로 그림을 생성하거나 저해상도 파일을 확대하지 않고 이전 내장 imagegen의 941×1672 투명 원본을 사용합니다. `web/src/assets/startup-brand-foreground.png`를 해당 원본으로 복원하고 같은 `#F5F2FD` 배경의 무손실 WebP를 Web `startup-brand.webp`와 Android `startup_brand.webp`에 동일하게 저장했습니다. 표시 자산은 194,808바이트이며 이전 JPEG의 양자화 손실을 재적용하지 않습니다. JPEG 참조/파일을 제거했습니다.

검사는 실제 브라우저와 Android에서 24px/dp 여백, 전체 이미지 보존, 941×1672 원본 로드와 기존 서버 준비·실패 조건을 확인하도록 변경합니다. Android v2.0.3/code41과 Web Git 자동배포 대상이며 Firebase 실행 코드는 변경하지 않습니다.

실제 Firebase Emulator·production build·WebKit의 마지막 잔액/첫 홈 검사 1개가 통과했습니다(전체 43.1초, 테스트 14.6초). 390×844·360×960·844×390·1280×800에서 전체 이미지와 24px 여백을 확인했습니다. API 36.1 실제 MainActivity의 이미지 보류·회전·표시 전환 검사 1개도 통과했습니다(4.583초). 휴대폰 캡처에서 크기 축소와 잘림 없는 표시를 확인했으며 검증 후 에뮬레이터를 정상 종료했습니다. 로그는 `%TEMP%/household-startup-sharpness-e2e-20261015.log`, `household-startup-sharpness-native-20261015.log`입니다.

Android debug·test·release build가 통과했습니다. 서명 APK는 v2.0.3/code41, 10,961,428바이트, SHA-256 `f898048085b72a240543689c352e672f28b3adb32b432f114907220baa79b165`이며 apksigner v2와 기존 인증서 일치를 확인했습니다. 로그는 `%TEMP%/household-v2.0.3-build-20261015.log`입니다. 요구사항 catalog 248개·test case 235개, E2E 추적성 244개·외부 검증 4개·누락 0개도 확인했습니다. 최소시간·준비 로직은 변경하지 않아 앞선 단위 검사를 반복하지 않았습니다.

## v2.0.4 후속: 표시 폭 상한과 물리 픽셀 검증

사용자는 v2.0.3도 여전히 크고 윤곽이 완전히 선명하지 않다고 보고했습니다. v2.0.3은 양옆 여백만 추가했으므로 390px 화면에서 이미지 폭이 342px이고, DPR 3에서는 1,026 물리 픽셀로 941px 원본보다 크게 표시될 수 있었습니다. 무손실 포맷만으로 고밀도 화면의 확대를 막는 것은 아닙니다. 사용자 기기의 설치 버전·실제 DPR은 확인되지 않아 이 경로를 해당 기기의 확정 원인으로 단정하지 않습니다.

Web/PWA와 Android 모두 이미지 전체 폭을 최대 240px/dp로 제한합니다. 390px 화면 기준 v2.0.3 대비 약 30% 작아지고 화면이 커져도 계속 커지지 않습니다. 바깥 24px/dp 여백과 가로·작은 창의 contain/fitCenter를 유지합니다. Android는 전체 배경용 FrameLayout과 폭 상한을 가진 기본 ImageView를 사용하며 새로운 사용자 정의 View나 타이머를 추가하지 않습니다. 전체 시작 레이어의 노출·오류·Web 전환은 기존 View 계약을 그대로 사용합니다.

941×1672 무손실 원본 파일은 다시 생성·변환하지 않습니다. Web의 DPR 3에서는 최대 720 물리 픽셀로 표시되며, 실제 Android에서도 표시된 물리 너비가 drawable 원본 너비 이내인지 검증합니다. 원본에 있는 부드러운 3D 음영까지 벡터처럼 바뀐다고 주장하지 않습니다. 기존 마지막 서버 응답 대기·회전·오류·최소 1.2초·계측은 유지하고 크기 및 원본 대비 표시 해상도를 검증합니다. Android v2.0.4/code42와 Web Git 자동배포 대상입니다.

실제 Emulator·production build·WebKit의 첫 홈/마지막 잔액 검사 1개가 통과했습니다(전체 41.4초, 테스트 13.9초). DPR 3 및 390×844·360×960·240×640·844×390·1280×800에서 폭 상한·중앙 배치·전체 내용 보존·원본 픽셀 이내 표시를 확인했습니다. 실제 API 36.1 MainActivity의 요청 보류·회전·Web 전환 검사 1개도 통과했습니다(5.981초). 최종 Android 세로·가로 및 WebKit DPR 3 캡처를 확인했습니다. WebKit 확인 캡처에서는 로딩 타이머만 정지했으며 계약 검사는 타이머를 바꾸지 않은 위 E2E 결과입니다. 로그는 `%TEMP%/household-startup-cap-{e2e,native,build}-20261015.log`입니다.

Android debug·test·release build가 통과했습니다(27초). APK는 10,961,596바이트, SHA-256 `fab13bcf4c7e5440bcfc52598a2814a3269f07665ead5c9355d127984267be2a`이며 v2 서명을 검증했습니다. 요구사항 248개·test case 235개·E2E 추적 누락 0개, diff 검사를 통과했습니다. 실제 Android와 Firebase 에뮬레이터 및 확인용 Web 서버를 종료했습니다.

### 앞선 CI 결과와 미확정 실패 보존

v2.0.1의 `38699457238`은 실제 Android를 포함한 다섯 검사·요약이 모두 성공했습니다. v2.0.2의 `38700717664`는 Android·Functions·Web 성공, Web E2E 112 passed/1 failed입니다. `ios-startup.spec.ts:102`의 검색 chunk 고의 실패 후 재시도에서 입력란을 30초 안에 찾지 못했습니다. trace에는 최초 abort 후 재요청·continue가 있고, 이후 검색/shared chunk·font·Listen에 `WebKit encountered an internal error`, Auth IndexedDB connection closing 오류가 함께 기록됐습니다. 재시도 요청에는 완료 HTTP 응답이 없으며 화면은 검색 로딩을 유지했습니다. 실패의 최초 원인은 미확정이며 크기 수정으로 해결됐다고 하지 않습니다.

동일 검사를 실제 Emulator·production WebKit에서 변경 없이 한 차례 재현 시도한 결과 1 passed(36.0초, 테스트 11.5초)로 실패가 재현되지 않았습니다. 기존 30초 기준·chunk 재요청 횟수·검색·편집·서버 저장 검증을 유지했습니다. 로그 `%TEMP%/household-startup-retry-repro-20261015.log`, CI 로그 `household-startup-v202-ci-38700717664.log`, artifact `household-startup-v202-ci-artifacts-38700717664`, trace `household-startup-v202-trace-38700717664`에 관측을 보존하며 다음 전체 CI 결과를 후속 확인합니다.

## v2.0.5 후속: 그림·선택 가구명·부제 분리

사용자는 제목과 부제가 붙어 보이고 작은 글씨가 흐린 점을 지적했으며, 또니망고네뿐 아니라 익태송희네에서도 사용할 수 있도록 가구명 분리를 요청했습니다. 문자까지 포함한 이미지를 확대·축소하는 대신 기존 그림과 실제 텍스트를 각각 표시합니다. 중간에 거절된 imagegen 시안은 사용하지 않습니다.

가구별 APK를 별도로 만들지 않고 기존 HouseholdContext의 선택 가구명을 사용합니다. `AppLoadingScreen`은 `household.name`을 그대로 읽어 제목으로 렌더링하며 새 가구 조회나 이름 저장소를 만들지 않습니다. 이름이 미확정인 인증 구간에는 40px 제목 공간만 남깁니다. 다른 가구의 이름이나 고정 기본 이름을 먼저 보여주지 않습니다. Native는 가구명 원본이 없으므로 40dp 공간을 비워 두고, 이름만을 위한 cache·Bridge를 추가하지 않습니다. 가구명이 준비된 Web으로 전환되면 현재 선택된 이름이 표시됩니다.

그림은 기존 `brand-icon-foreground.png`의 1254px 투명 원본에서 지갑·사람 카드·동전만 무손실 WebP로 재사용합니다. Web `startup-illustration.webp`와 Native `startup_illustration.webp`에 제목·부제·점 이미지를 넣지 않습니다. 그림의 표시 크기는 180px/dp이고 Web 높이 또는 Native 가용 높이가 400px/dp 미만이면 120px/dp로 줄입니다. 바깥 여백은 24px/dp, 배경은 기존 `#F5F2FD`입니다.

Web 제목에는 로컬 Jua WOFF2(368,804바이트)를 사용하고 OFL 라이선스를 함께 저장합니다. 제목은 30px 크기·40px 줄높이이며 끝 글자 ‘네’만 기존 보라색으로 표시하고 이름 문자열은 유지합니다. 부제 ‘가계부 · 자산’은 기존 Pretendard의 실제 15px 텍스트, 22px 줄높이, 제목 공간 아래 20px 간격을 사용합니다. Native도 15sp TextView와 20dp 간격으로 부제를 표시합니다. 하단 점 세 개는 각각 Web 요소와 Native drawable로 표시합니다. 문서당 1.2초, 인증·첫 홈 전체 데이터 준비·오류·첫 paint 계측과 Native `postVisualStateCallback` 전환 조건은 변경하지 않습니다.

선택 가구명 두 종류·이름 미확정 구간·제목/부제 분리·간격·폰트·그림 크기와 작은 높이 대응을 검증하고 기존 실제 브라우저·Android의 이미지 보류·회전·첫 홈 준비 조건도 유지합니다. 배포 대상은 Web Git 자동배포와 Android v2.0.5/code43이며 Firebase 실행 코드는 변경하지 않습니다.

### 앞선 CI 결과와 종료 원인 관측

- v2.0.3 `c7b01cd7bafb00554fe8d7d2363a31c4dab7f5dc`의 CI `38701984715`는 실제 Android를 포함한 다섯 검사와 요약 모두 success입니다.
- v2.0.4 `aa183e56fadd0861877e7d606b270a3538956892`의 CI `38703934405`는 Android instrumentation 48개 중 11개 실행 후 프로세스가 종료됐습니다. 첫 `realWebViewBridgeIsOriginBoundAndHistoryBackKeepsTheActivityOpen` 중 2026-10-15 08:17:15.098 UTC에 GMS Chimera가 RCS 모듈 변경 때문에 persistent 프로세스를 재시작했고, 08:17:15.212에 Android ActivityManager가 FontsProvider 의존성을 이유로 가계부 프로세스를 SIGKILL했습니다. 로그의 `depends on provider com.google.android.gms/.fonts.provider.FontsProvider in dying proc`가 직접 종료 이유입니다. 시작 이미지 크기 assertion 실패와 구분하며, 실행되지 않은 후속 검사를 성공으로 기록하지 않습니다.
- 앱의 병합 manifest에는 AppCompat 전이 의존성인 `EmojiCompatInitializer`가 있습니다. 초기 이모지 글꼴 조회가 GMS 의존 경로로 추정되지만, 이모지 초기화를 끄거나 앱 동작을 바꾸어 검사를 우회하지 않습니다. 이번 직접 실패는 google_apis 에뮬레이터 부팅 직후 GMS 재시작과의 환경 경합이며 운영에서도 같은 상황이 발생했는지는 확인하지 않았습니다.
- 기존 CI 결과 수집 블록에 앱과 GMS 각각의 `dumpsys activity exit-info`를 추가해 `app-exit-info.txt`·`gms-exit-info.txt`로 실패 artifact에 보관합니다. 기존 검사·대기·종료 코드·실패 판정은 유지하고 진단 명령 실패가 원래 검사 결과를 덮지 않게 합니다. YAML 파싱·Bash 문법·추가된 두 명령 외 기존 내용 일치·artifact 경로를 확인했습니다. 과거 실패를 성공으로 덮거나 같은 SHA를 재실행하지 않습니다.
- 기존 로그는 `%TEMP%/household-startup-v204-ci-38703934405.log`, artifact는 `%TEMP%/household-startup-v204-ci-artifacts-38703934405`에 보존했습니다. Web E2E 등 남은 결과는 해당 실행의 실제 완료 결과로 후속 확인합니다.


### v2.0.5 로컬 검증

관련 Jest 2파일 32개와 Web 타입 검사가 통과했습니다. 실제 Firebase Emulator와 production build를 사용하는 WebKit에서 또니망고네·익태송희네 각각의 첫 홈/마지막 잔액 검사 2개가 통과했습니다(56.2초). 두 가구 모두 390×844·360×960·240×640·844×390·1280×800에서 실문자 가구명·부제, 20px 간격, 글꼴 준비, 180/120px 그림 크기와 전체 내용 보존을 확인했습니다. 기존 전체 데이터 준비 전 홈 미표시·준비 후 바로 전환·paint 계측 조건도 통과했습니다.

실제 API 36.1 MainActivity 이미지 보류·회전·전환·복귀 검사 1개가 통과했습니다. Gradle 완료 후 기기에서 제거된 캡처를 다시 얻기 위해 동일 검사를 직접 instrumentation으로 실행했고 1개 통과(4.619초), 세로·가로 원본 캡처를 확인했습니다. Android debug·test·release 빌드도 통과했습니다(18초). 요구사항 248개·test case 235개·E2E 추적 누락 0개입니다.

Jua 원본은 Google Fonts `ofl/jua/Jua-Regular.ttf`이며 글리프를 수정하거나 특정 가구 문자만 추출하지 않고 FontTools로 WOFF2 변환했습니다. 원본 라이선스 `OFL-Jua.txt`를 함께 보존하며 이름이 달라도 같은 글꼴을 사용할 수 있습니다. 서명 APK는 v2.0.5/code43, 11,267,440바이트, SHA-256 `37f07eadda45350f0a36b323493522e4bc9b45b4864fce863094f902b2d01d11`입니다. 기존 인증서 SHA-256 `09bd620a673ce537ab3bcd54fe2cf4d2c6d806e553d456beb7ebd80830397bfa`와 일치하고 apksigner 검증을 통과했습니다.

로그: `%TEMP%/household-startup-text-{build,types,prepare,e2e,native,native-capture}-20261015.log`. Web Git 배포와 APK 공개는 이 검증 결과를 포함한 커밋으로 진행하며 원격 CI는 해당 SHA로 후속 확인합니다.


## v2.0.6 후속: 지정 시안 비율·하단 점·최소 2초

사용자가 `1000017858.jpg`의 그림·제목·부제 크기와 굵기를 지정하고 점 세 개만 원래처럼 화면 하단으로 이동하도록 요청했습니다. 후속 요청으로 최소 표시 시간을 2초로 늘렸습니다. 720×1280 시안을 390px 폭으로 환산하면 그림의 색상 영역은 약 156.5×128.4px, 제목은 132.7×26.5px, 부제는 107.8×15.7px입니다. 기존 대비 그림·제목은 약 10%, 부제는 약 15% 확대하고 부제의 굵기를 600에서 700으로 바꿉니다. Jua는 원래 굵은 단일 서체이므로 합성 굵기를 추가하지 않습니다.

중앙에는 그림·제목·부제만 배치합니다. Web 화면 폭 390px를 기준으로 그림은 198px, 제목은 글자 크기 33px와 줄높이 44px입니다. 제목의 위쪽 여백은 그림 요소 아래에서 -6px이며, 부제는 글자 크기 17px와 줄높이 26px, 제목 요소 아래 8px 간격을 사용합니다. 작은 화면 폭에서는 비례 축소하되 제목 24px·부제 14px를 하한으로 둡니다. 그림의 투명 여백과 글꼴에서 실제 색이 있는 영역을 기준으로 하면 시안의 그림→제목 약 26.5px, 제목→부제 약 21.7px 간격에 대응합니다. 7px 점 세 개는 화면 하단에서 64px와 safe-area를 더한 위치로 이동합니다. 화면 높이가 400px 미만이면 그림은 120px, 하단 간격은 24px로 줄여 가로 화면에서도 겹치지 않게 합니다.

Native는 같은 원본과 대응하는 dimension resource를 사용해 그림을 182/198dp로 표시하고, 높이가 작은 화면에서는 120dp로 줄입니다. 하단 점은 FrameLayout의 bottom 정렬만 사용하므로 별도 런타임 배치 코드가 없습니다. 가구명이 미확정인 구간은 40/44dp 공간만 예약합니다. 기존 선택 가구명·한글 실제 텍스트·단색 배경·권한/오류 화면·첫 문서 visual callback 전환 계약을 유지합니다.

`STARTUP_MINIMUM_DISPLAY_MS`는 2,000입니다. 기존 Provider에서 인증·조회와 함께 시작하고, 준비된 홈은 2초가 끝나면 바로 표시합니다. 2초보다 늦은 조회 뒤에는 추가 대기를 더하지 않으며 오류는 즉시 표시합니다. 관련 단위 계약은 1,999ms/2,000ms 경계와 2.5초 조회 완료, 재조회·경로 전환에서 타이머를 다시 시작하지 않는 동작을 검증합니다. Android에 별도 타이머는 추가하지 않습니다. Web Git 자동배포와 Android v2.0.6 / code 44 대상이며 Firebase는 변경하지 않습니다.

### 이전 CI 실패 보존

v2.0.4의 CI `38703934405`는 Web E2E도 112 passed / 1 failed로 끝났습니다. `notification-deeplink.spec.ts:12`의 legacy 검사는 링크 이동 전 fixture 준비 과정에서 `/`로 다시 이동한 뒤 로그인 화면으로 돌아가 달력을 30초 동안 찾지 못했습니다. 재탐색 약 95ms 전 여러 리소스에서 WebKit 내부 오류가, 재탐색 중에는 Auth IndexedDB closing 오류가 관측됐습니다. 시작 이미지는 두 번 모두 HTTP 200이었으며 최초 원인과 운영 재현 여부는 미확정입니다. 분석은 `%TEMP%/household-startup-v204-web-failure-38703934405-analysis.txt`에 보존했습니다.

v2.0.5의 CI `38706624724`는 실제 시작 화면 검사가 통과했지만, Android 48개 중 기존 `backgroundRendererTermination` 검사가 ActivityScenario의 `CREATED` 전환 중 실패했습니다. 테스트용 EmptyActivity가 닫히면서 MainActivity가 `STOPPED`에서 `RESUMED`로 돌아왔고 renderer 종료 단계에는 도달하지 않았습니다. 정확한 helper 종료 요청자는 미확정이며 시작 화면 변경으로 해결됐다고 하지 않습니다. 분석은 `%TEMP%/household-startup-v205-ci-38706624724-analysis.txt`에 보존했습니다. 기존 검사·제한·실패 판정을 유지하고 최신 후보의 전체 Android 결과를 후속 확인합니다.

### v2.0.6 로컬 검증

관련 Jest 2개 파일 32개 검사가 통과했습니다. 실제 Firebase Emulator와 production build를 사용하는 WebKit에서 두 가구의 시작 화면 검사 2개가 통과했습니다(전체 1.0분). 실제 API 36.1의 시작 화면 보류·회전·전환 검사 1개도 통과했습니다(4.971초). Android release·debug·test 빌드는 11초에 완료됐습니다.

첫 Android 검사는 부제 크기의 기대값 44.625px와 실제 값 45px를 비교해 실패했습니다. TextView는 dimension으로 지정한 textSize를 정수 px로 반올림하므로, 이는 제품 크기 오류가 아닌 테스트 관측 오류였습니다. 기대값도 `getDimensionPixelSize`로 읽어 같은 변환 계약을 확인하도록 수정했습니다. 허용 오차를 넓히지 않았습니다.

로그는 `%TEMP%/household-startup-reference-{build,e2e,native}-20261015.log`에 보존했습니다.

최종 WebKit 캡처에서 Pretendard Variable은 계산된 굵기가 700이어도 부제가 얇게 표시됐습니다. 시작 화면 부제에만 시스템 sans-serif 굵기 700을 사용해 Native의 굵은 실제 텍스트와 맞췄습니다. 제목 Jua와 기존 그림 원본은 그대로 유지하며, 비교 캡처는 `%TEMP%/household-subtitle-{css,axis,system}-weight.png`에 보존했습니다.

v2.0.5 Web E2E는 113 passed / 1 failed입니다. 무응답 재시도 검사에서 status 전체 문자열을 `로딩중...`과 정확히 비교했지만, 분리된 가구명·부제도 같은 status에 포함되어 기존 기대값이 깨졌습니다. 로딩 안내·가구명·부제를 각각 확인하도록 관측을 갱신하며, 기존 20초 오류·무표시·재시도 후 최신 값·새 문서·계측 조건은 유지합니다. 로그는 `%TEMP%/household-startup-v205-web-38706624724.log`에 보존했습니다.

서명 APK는 v2.0.6/code44, 11,271,696바이트, SHA-256 `8cae71f3c627e9dc06a6b4ff509896c2787bf66a9cef6dd725e1767007aebd3e`입니다. apksigner v2와 기존 인증서 일치를 확인했습니다. 이전 공개 APK는 덮어쓰지 않습니다.

최종 시스템 글꼴 적용 후 실제 Emulator·production build·WebKit의 두 가구 시안 검사와 Listen 보류 중 Lite 첫 홈 전환 검사 총 3개가 통과했습니다(1.2분). 최소 2초 이후 로딩→준비된 홈의 두 단계만 나타나며 전환 시점·서버 준비·첫 paint 계측이 일치했습니다. 최종 캡처 `%TEMP%/household-startup-v206-final.png`에서 부제 굵기와 하단 점 위치도 확인했습니다. 로그는 `%TEMP%/household-startup-reference-final-e2e-20261015.log`입니다.
