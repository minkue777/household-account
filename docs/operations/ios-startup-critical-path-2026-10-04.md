# iPhone 첫 홈 연결 준비와 사용 시점 코드 로드

## 근거와 범위

운영 iPhone PWA 완료 로그 17건 중 새 읽기 구간을 포함한 5건을 확인했습니다. 10월 2일 23:42 KST 기록은 전체 5.325초 중 구독 시작부터 최초 서버 snapshot까지 약 3.69초였고, 가구·원장·카테고리·지역화폐 snapshot이 3ms 안에 함께 도착했습니다. 같은 배포의 10월 3일 12:19 기록은 전체 2.995초, 첫 서버 snapshot 대기 약 0.70초였습니다. 10월 2일 18:31 기록은 앱 bootstrap까지 3.691초(HTML 응답 완료 2.818초)와 첫 서버 snapshot 대기 약 2.44초가 함께 발생했습니다.

10월 3일 21:52의 26.115초는 hidden 25.592초가 포함된 기록입니다. 데이터 준비는 5.501초였고 최종 paint 관측이 늦었습니다. hidden 시간을 단순 차감하여 체감 시작 시간으로 사용하지 않습니다. 로그 시각은 서버 수신 시각이며 특정 사용자의 기록으로 식별하지 않습니다.

이번 변경은 사용자와 합의한 1차 후보인 연결 사전 준비와 초기 코드 분리입니다. 첫 서버 응답의 네트워크·SDK·서버 구간 원인은 아직 분리되지 않았습니다. Firestore Lite 첫 홈 조회, 전송 설정 변경, 영속 금융 화면 cache 복원은 포함하지 않습니다.

## 요구사항·계약·설계

- AND-012 / T-WEBVIEW-004: 운영 HTML에서 필요한 두 origin의 연결을 준비하며 Emulator 빌드는 운영 preconnect를 만들지 않습니다. 데이터 요청·token 갱신을 추가하지 않습니다.
- AND-012: 첫 홈에서 닫힌 모달과 날짜별 상세를 정적 의존성에서 분리합니다. 사용 시점의 로딩·실패 상태를 해당 영역에 한정하고 재시도를 제공합니다.
- SYS-008 / T-SYS-008: 로그인 유지·최신 서버 자료·지출 추가·검색·편집과 화면 이동을 production WebKit에서 검증합니다.
- ADM-006 / T-ADM-005: 기존 auth/read/ready/paint 진단과 완료 기준을 유지합니다. 숨김이 없는 같은 기기·네트워크의 후속 표본으로 실제 효과를 판단합니다.
- Auth 영속 저장소, iPhone memory cache와 long-polling, 첫 서버 snapshot 우선, 실시간 구독과 낙관적 변경은 유지합니다. 홈 JavaScript 감소가 HTML 응답 대기나 첫 Firestore 응답 대기 전체를 제거한다는 뜻은 아닙니다.

## 검증 및 추적성

| 검증 | 대상 |
|---|---|
| 운영 head의 제한된 preconnect / Emulator 운영 힌트 제외 | RootLayout, production HTML |
| 첫 홈에서 미사용 코드가 포함되지 않고 첫 사용 시 로드 | production chunk manifest, `web/e2e/ios-startup.spec.ts` |
| 최신 홈·로그인 유지·추가·검색·편집·시작 진단 | 실제 WebKit + Auth/Firestore/Functions Emulator |
| 지연 로딩 실패 및 재시도 | 비동기 UI 경계 계약 검사 |
| 기존 준비 조건·세션·낙관적 편집 | 관련 Web 회귀 검사와 타입 검사 |

Web 회귀 검사 4파일 16개와 `tsc --noEmit`이 통과했습니다. 실제 지연 loader의 최신 props 전달·미사용 시 미호출·실패 후 재시도, 기존 첫 paint 조건·편집 링크와 런타임 경계를 검사했습니다. Functions Emulator 준비의 architecture 45개와 세 codebase 빌드도 통과했습니다. 요구사항 catalog와 E2E 추적성 검사를 완료했습니다.

변경 전 `49f16e1`과 변경 후 각각 동일한 운영 설정으로 production build를 실행했습니다. `/layout`과 `/page` manifest의 JavaScript 파일을 중복 제거하고 파일별 gzip 크기를 더한 결과입니다.

| 최초 정적 JavaScript | 변경 전 | 변경 후 |
|---|---:|---:|
| 원본 bytes | 1,101,905 | 1,022,277 |
| gzip bytes | 326,963 | 305,985 |

gzip 20,978 bytes(6.42%) 감소했습니다. 여섯 `home-*` 파일이 별도 chunk로 생성되고 운영 HTML에 제한된 두 preconnect가 포함된 것을 확인했습니다. 실제 HTTP 압축 방식·동적 SDK 로드·Service Worker precache를 모두 합한 전송량 또는 실기기 시간은 아닙니다. 정적 asset precache는 기존대로 첫 paint 이후 진행합니다. 토큰 요청은 anonymous, Firestore WebChannel은 SDK의 cross-domain credential 사용에 맞춘 연결 힌트를 사용합니다.

production WebKit의 실제 chunk 미요청·추가·검색·편집·chunk 실패 후 재요청, 로그인 재실행·진단·알림 편집 회귀를 진행합니다. 로컬 로그와 크기 근거는 저장소 밖 `TEMP/household-ios-startup-{before-build,after-build,prepare,e2e}-20261004.log`, `TEMP/household-ios-startup-bundle-{before,after}-20261004.json`입니다.

Web 실행 코드만 변경하므로 main push의 Vercel Git 자동배포 대상이며 Firebase와 APK 재배포는 필요하지 않습니다. 운영 데이터는 변경하지 않습니다. 정확한 SHA의 CI·배포와 후속 실기기 기록으로 전달 상태와 성능 효과를 별도로 확인합니다.
