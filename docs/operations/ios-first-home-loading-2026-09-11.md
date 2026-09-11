# iPhone PWA 첫 홈 로딩 조사 — 2026-09-11

## 관측과 결론

운영 Cloud Logging의 `interactive-latency.v1`, `endpoint=clientStartup`, `stage=total`을 읽기 전용으로 조회했습니다. 2026-09-09 00:00 UTC 이후 iPhone PWA 8건은 2,505~5,557ms, 중앙값 3,005ms였습니다. 사용자께서 말씀하신 3초대 지연이 실제 계측에도 나타납니다. 사용자·가구·거래 원문은 조사 결과에 저장하지 않았습니다.

현재 운영 로그는 첫 홈 완료까지의 합계만 기록합니다. Auth·Membership·Household 등의 Web Performance mark는 있으나 그 단계별 값은 운영 로그에 포함되지 않습니다. 실제 기기의 iOS 버전과 변경 후 표본도 아직 확보하지 못했습니다. **전체 3초의 어느 정도가 아래 문제 때문인지, 1초대로 단축되는지는 아직 확인하지 않았습니다.**

최종 수정 대상은 **iPhone PWA의 Firestore 응답 전송 방식**입니다. WebKit 검증에서 인증·구독 요청은 정상인데 collection 결과 전달이 멈추는 현상을 발견했고, 변경 전 캐시 설정으로 돌린 대조 실험에서도 같은 현상이 발생했습니다.

## 원인을 좁힌 근거

1. 실제 Auth·Functions·Firestore Emulator와 WebKit에서 가구 생성과 초기 문서 조회가 성공했습니다. 이후 지역화폐·카테고리·월 원장 target을 실제 SDK가 서버에 전달했으나 UI가 30초 동안 완료되지 않는 경우가 있었습니다. 요청은 HTTP 200이며 인증·권한 거부가 없었습니다. 열린 응답 본문은 Playwright trace에 남지 않아 완료 frame 자체는 확인하지 못했습니다.
2. 네트워크를 인위적으로 보류하던 초기 테스트를 제거한 정상 진입에서도 재현됐습니다. 따라서 테스트 interception만의 문제라는 초기 판단은 철회했습니다.
3. 제안했던 memory cache 전환을 되돌리고 **변경 전 persistent cache**로 실행해도 지역화폐 변경 수신에서 30초 timeout이 재현됐습니다. 캐시 변경만으로 해결되는 현상이 아닙니다.
4. [Firebase SDK 이슈 #9789](https://github.com/firebase/firebase-js-sdk/issues/9789)에서 유지보수자는 Safari 26.5가 데이터를 받은 뒤 완료 frame을 backend keep-alive까지 보류하는 현상을 재현했다고 설명했습니다. Safari 26.4 이후 조회·구독 지연 보고이며, 2026-08-23에는 공개 long-polling 옵션을 켠 대조 실험의 개선 결과도 보고됐습니다. 외부 사용자의 측정값을 이 앱의 성능 결과로 사용하지 않습니다.
5. [WebKit bug 322545](https://bugs.webkit.org/show_bug.cgi?id=322545)는 streaming fetch의 버퍼를 다음 네트워크 데이터까지 전달하지 않는 결함을 설명합니다. 2026-08-27 main에 수정됐지만, 사용자의 Safari에 그 수정이 포함됐는지는 확인하지 못했습니다. 현재 재현과 일치하는 강한 후보이며 이 앱의 운영 지연과 동일한 결함이라고 완전히 확정한 것은 아닙니다.

## 최종 변경

`web/src/lib/firebase.ts`에서 `Platform.isIOSPWA()`인 경우에만 `experimentalForceLongPolling: true`를 설정합니다. Firebase의 공개 설정이며 내부 `useFetchStreams` 옵션이나 별도 timeout·재시도·주기 조회는 추가하지 않습니다.

[Firebase API 설명](https://firebase.google.com/docs/reference/js/firestore.firestoresettings#firestoresettingsexperimentalforcelongpolling)에 따르면 이 방식은 서버가 데이터를 보내면 응답을 닫아 무기한 버퍼링을 피합니다. 실시간 구독 자체는 유지되며 일정 간격마다 전체 원장을 다시 가져오는 구현이 아닙니다. 대신 HTTP 요청·응답 처리 횟수가 늘어 정상 streaming보다 일부 성능 비용이 생길 수 있어 iPhone 홈 화면 PWA에 한정합니다.

- Android: 기존 memory cache와 기본 전송 유지.
- iPhone PWA: 기존 multiple-tab persistent cache·resume token과 Auth 로그인 저장소 유지, 전송만 변경.
- 일반 Safari·데스크톱 브라우저: 기존 설정 유지.
- 최초 원장·카테고리·지역화폐: 계속 서버 snapshot부터 표시.

처음 조사한 영속 캐시의 서버 요청 전 로컬 조회 비용도 실제 SDK에서 재현됐습니다. Windows Chromium·합성 거래 6,480건의 비교에서는 저장된 캐시 조건에서 54~156ms 차이가 있었습니다. 하지만 iPhone A/B 근거가 부족하고 cache가 서버 재전송을 줄이는 이점도 있어 **memory 전환은 최종 변경에서 제외했습니다.**

## 검증 방법과 결과

새 WebKit E2E는 iPhone user agent와 standalone 환경에서 실제 SDK·Emulator를 사용합니다. 실제 UI로 로그인·가구·거래를 생성하고, 지역화폐 read model fixture를 준비합니다. 페이지를 닫은 동안 서버 잔액을 25,789→36,890으로 바꾸고 같은 browser context의 새 페이지에서 로그인·거래·카테고리·최신 잔액·첫 홈 완료 mark를 확인합니다. IndexedDB open을 관찰해 Auth와 Firestore 영속 저장소 유지도 검사합니다. 오류 필터, timeout 증가, 네트워크 대역은 사용하지 않습니다.

Windows WebKit 엔진에서의 실제 앱 기능 검사이며, 설치된 iPhone PWA의 속도·Service Worker·OS 복귀를 직접 검증한 결과로 대체하지 않습니다.

최종 전송 변경의 로컬 검증 결과:

- Web Jest: 100개 파일, 628개 테스트 통과.
- 실제 Firebase 업무 E2E: Chromium 1개와 WebKit 1개 통과. WebKit 정상 재실행을 별도로 3회 더 실행해 모두 통과했습니다. 최종 전송 설정에서 총 4회 성공했으며 timeout·오류 검사를 완화하지 않았습니다.
- 최종 production build와 production/PWA E2E 2개 통과.
- Functions `test:quality-gate`: 322개 파일, 2,857개 테스트와 타입·경계·빌드 통과. 기본 명령에서 별도 Emulator 통합 16개 파일·81개 테스트가 생략되는 기존 구성은 유지합니다.
- 이번 작업 중 Android 단위 테스트 116개·instrumentation 20개·lint·Debug/Release 빌드 통과. 최종 변경에서도 Android의 캐시·전송 분기는 동일하게 유지합니다.

작업 트리에 반영했으며 아직 커밋·push·배포하지 않았습니다. 운영에서 같은 iPhone의 재실행 표본을 추가로 모아 기존 중앙값 3,005ms와 비교해야 합니다. 로컬 성공이나 외부 이슈의 개선 수치를 실제 iPhone의 단축 시간으로 해석하지 않습니다.
