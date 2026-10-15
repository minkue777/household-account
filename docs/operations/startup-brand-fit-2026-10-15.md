# 시작 화면 맞춤·최소 표시와 아이콘 배경 수정

> 현재 색상은 아래 v2.0.2 후속 절의 사용자 참조색 `#F5F2FD`입니다. 최초 v2.0.1 검증·배포 이력은 보존합니다.

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
