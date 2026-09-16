# Android 홈 50.7초 관측 원인 분석

아래 원인 분석은 제품 수정 전 기록입니다. 분석 완료 후 사용자가 승인한 보완은 마지막의 "후속 제품 수정"에 따로 기록합니다.

## 범위

2026-09-17 Android AVD 성능 측정 중 홈 재실행 6회차의 50,666.6ms만 조사합니다. 제품 동작 수정이나 다른 기능의 최적화는 포함하지 않습니다. 사용자 요청에 따라 이 1회는 [일반 성능 통계](core-feature-performance-2026-09-17.md)에서 제외하고, 원본 7회와 제외 전 통계는 [기준선 JSON](core-feature-performance-2026-09-17.samples.json)의 `androidExcludedObservationDiagnostic`에 보존합니다. 향후 테스트의 느린 표본을 자동 제외하는 코드는 추가하지 않았습니다.

## 기존 실행에서 확인한 사실

- 대상 환경은 API 36 AVD, WebView 151.0.7922.199, debug APK, production Next.js, 로컬 Firebase Emulator입니다. 운영 휴대폰의 측정값이 아닙니다.
- 기본 테스트는 로그인 준비용 Activity 1개 뒤 측정용 Activity 7개를 같은 앱 프로세스에서 연속 생성·종료합니다. 이상치는 전체 7번째 WebView에서 발생했습니다.
- 테스트의 홈 완료 관측은 50,666.6ms였습니다. 같은 실행에서 제품의 `client.android-app-first-home-complete-paint.v1` 기록도 50,687ms였습니다. 제품 기록은 `AppLaunchDurationClock`의 Android 단조 시계를 사용하므로 테스트의 JavaScript 시각 환산만으로 생긴 오차로 설명할 수 없습니다. 단, 두 기록 모두 같은 테스트 환경에서 얻었으며 실기기에서의 재현을 뜻하지 않습니다.
- `MainActivity`에는 Activity 종료 때 WebView를 명시적으로 정리하는 코드가 없습니다. 기본 테스트의 `ActivityScenario.close()`와 WebView 내부 상태 해제는 별개의 동작입니다. Android 공식 문서는 View 시스템에서 제거한 뒤 `destroy()`로 내부 상태를 해제하도록 설명합니다. [WebView API](https://developer.android.com/reference/android/webkit/WebView#destroy())
- Android는 Firestore `memoryLocalCache`를 사용합니다. IndexedDB primary lease 획득 지연이라는 설명은 이 실행 경로에 맞지 않습니다.
- 홈 완료 표시는 월 원장·카테고리·지역화폐 등의 데이터 준비 후에 발생합니다. 월 원장은 첫 서버 snapshot 전의 캐시 snapshot을 완료로 인정하지 않으므로 초기 Firestore 연결이 지연되면 홈 완료도 지연됩니다.
- 이전 WebView를 테스트에서 정리한 별도 7회 측정은 1,013.6~1,196.0ms였습니다. 조건당 한 배치만으로 원인을 확정하지 않습니다.

## 추가 재현과 원인

**종료된 Activity의 WebView와 Firestore 연결이 남는 상태에서 연속 실행하면, 새 문서의 Firestore 연결이 대기하는 현상을 재현했습니다.** 기본 조건에서 원래와 같은 측정 6회차가 52,095.2ms 걸렸습니다. CDP에서 준비 실행을 포함한 WebView target이 1→2→…→7개로 늘어나는 것을 확인했고, 이전 WebView를 명시적으로 정리한 조건에서는 7회 모두 약 1초에 완료됐습니다.

| 추가 진단 조건 | 원본 7회 ms | 중앙값 ms | 최대 ms |
|---|---|---:|---:|
| 제품의 기존 Activity 종료 동작 | 1060.3, 1144.0, 1022.2, 1218.7, 1437.9, 52095.2, 3023.7 | 1218.7 | 52095.2 |
| 이전 WebView를 테스트에서 명시적으로 정리 | 1039.9, 995.4, 1049.1, 957.9, 1046.3, 975.1, 1022.4 | 1022.4 | 1049.1 |

지연된 새 문서 자체는 빠르게 준비됐습니다. 아래 Web 시각은 문서 navigation을 시작점으로 하며, Native Activity 시각과는 시작점이 약간 다릅니다.

| 관측 단계 | 문서 시작 후 |
|---|---:|
| HTML 응답 완료 | 56.0ms |
| DOMContentLoaded 완료 | 172.9ms |
| load 완료 | 332.2ms |
| Firebase Auth 준비 | 349.0ms |
| Firestore 10초 응답 대기 경고 및 household 읽기 실패 mark | 약 10.4초 |
| 월 원장 첫 paint 및 홈 전체 완료 mark | 약 52.06초 |

따라서 HTML 다운로드·초기 JavaScript 실행·로그인 복원에서 50초를 소비한 것이 아닙니다. Firestore 연결이 진행되지 못해 데이터 준비를 기다린 것입니다. Native 측 launch 요청→`onActivity`는 254ms, Activity 생성→첫 JavaScript 관측은 205ms, JavaScript 관측 콜백의 최대 대기는 87ms였습니다. 테스트의 Activity 진입·JavaScript 콜백 대기가 50초를 만든 설명도 이 재현과 맞지 않습니다. 제품의 독립 Native 시작 기록은 52,132ms로 테스트의 52,095.2ms와 일치했습니다.

새 문서의 최초 `Listen/channel` 요청은 23:24:23.274Z에 관측됐지만 응답을 받지 못했습니다. 약 45.03초 뒤 23:25:08.307Z에 재요청했고, 그 요청에서도 실제 DNS·연결 시작까지 약 6,441ms가 걸렸습니다. 전송 시작부터 응답 헤더까지는 약 33ms였습니다. 이 구간은 데이터 조회 계산보다 **연결 전 대기와 재시도**가 지연의 대부분을 차지했음을 보여줍니다.

앞선 5회차 문서의 장기 Listen 요청 `6099.979`는 CDP 단조 시각 365.342500초에 종료됐고, 지연된 문서의 재요청 `6099.1165`는 365.346590초에 전송되기 시작했습니다. 기존 연결이 끝난 약 4.1ms 뒤 새 요청이 진행된 것입니다. 정리 조건에서는 WebView target 수가 매회 1→0으로 돌아왔고 Firestore 응답 대기 경고도 없었습니다.

Emulator의 실제 응답 프로토콜은 HTTP/1.1이었습니다. Chromium 일반 연결의 그룹당 기본 한도는 6이며, 여러 문서의 오래 유지되는 Listen 연결이 같은 origin을 점유하는 조건과 부합합니다. [Chromium 연결 관리 소스](https://chromium.googlesource.com/chromium/src/net/+/master/socket/client_socket_pool_manager.cc)

동시 소켓 슬롯 고갈 자체를 NetLog로 직접 관측하지는 않았으므로, 6개 연결 한도가 대기를 유발했다는 세부 기전은 관측 결과에 근거한 추론입니다. WebView 누적·연결 전 대기·기존 요청 종료 직후 새 요청 진행·정리 조건에서 지연 소멸은 직접 관측했습니다.

앱에 고정 50초 대기 코드는 없습니다. 설치된 WebChannel 구현에는 기본 요청 watchdog 45초가 있으며, 재현에서 관측한 최초 요청→재요청 간격과 일치합니다. [WebChannel 요청 timeout 원본](https://raw.githubusercontent.com/google/closure-library/master/closure/goog/labs/net/webchannel/channelrequest.js) Firestore의 10초 경고는 초기 watch 응답이 없는 상태를 Offline으로 분류하는 별도 동작입니다.

## 해석과 수정 범위

- 코드에서 개선할 위치는 `MainActivity`의 WebView 종료 처리입니다. Activity가 종료될 때 문서와 연결을 명시적으로 정리하는 것이 관측된 누적 문제를 직접 다루는 방향입니다. 이번 요청에서는 제품 코드를 수정하지 않았습니다.
- 이번 결과는 **동일 프로세스에서 Activity를 연속 생성하는 테스트와 로컬 HTTP/1.1 Firestore 연결 조건**에서 입증했습니다. 운영 휴대폰에서 같은 50초 지연이 발생한다고 일반화하지 않습니다.
- 추가 CDP 계측은 실행 시점과 GC에 영향을 줄 수 있습니다. 다만 CDP를 붙이기 전 원본에서도 같은 회차에 50.7초와 Firestore 응답 대기 경고가 발생했고, 두 번의 WebView 정리 조건에서는 큰 지연이 사라졌습니다.
- 원본 50.7초 실행에는 상세 네트워크 구간 기록이 없습니다. 45초 재시도와 6.4초 연결 전 대기는 **이번 52.1초 재현의 직접 관측값**이며, 원본의 모든 밀리초를 동일하게 분해했다고 주장하지 않습니다.
- 추가 진단은 일반 성능 통계에 합치지 않습니다. 임시 계측과 명시적 WebView 정리는 테스트 비교용이며 제품 수정으로 배포하지 않습니다.

추가 진단 산출물은 `web/performance-results/diagnostics/`의 `android-home-outlier-cause-summary.json`, `android-home-trace-production.json`, `android-home-trace-isolated.json`, 각 `*-polls.json`, `android-cdp-production2.jsonl`, `android-cdp-isolated.jsonl`에 보존합니다. Git에는 원본 요청 추적 대신 이 요약을 남깁니다.

임시 변경했던 Kotlin 성능 테스트·Native runner·로컬 Web runtime 3개 파일은 백업 SHA-256와 동일하게 복원했습니다. 이번 진단이 기동한 에뮬레이터와 관측 프로세스도 종료했습니다. 최종 변경은 이 분석 문서와 기존 통계 문서·JSON뿐입니다.

## 일반 통계 처리 결과

| 포함 표본 | 최소 | 중앙값 | 평균 | 최대 |
|---|---:|---:|---:|---:|
| 원래 1·2·3·4·5·7회차, n=6 | 1.052초 | 1.310초 | 1.618초 | 2.752초 |

제외된 6회차는 50.667초입니다. 통계 제외는 해당 지연의 수정이나 해결을 의미하지 않습니다. Web·Quick Edit·기존 WebView 정리 진단의 값은 변경하지 않았습니다.

## 후속 제품 수정 — Android v1.2.26

사용자 승인 후 `MainActivity.onDestroy`에서 lifecycle 취소, Web message listener 제거, 로딩 중지, 부모 View에서 분리, WebView 해제를 수행하도록 보완했습니다. 대기 중인 브리지 요청도 결과 전송 직전에 `ensureActive()`로 취소 여부를 확인하여 해제된 WebView로 늦은 응답을 보내지 않습니다.

일시적인 백그라운드 이동에서는 기존 문서를 유지합니다. Activity 재생성은 이전 WebView를 해제하고 저장된 navigation을 새 WebView로 복원합니다. 로그인 저장소·쿠키·캐시 삭제나 전역 Firebase 종료는 추가하지 않았습니다.

실제 Activity와 WebView를 사용하는 회귀 검증을 추가했습니다. finish 시 부모에서 분리된 상태로 한 번 해제되는지, 백그라운드 왕복 시 동일 문서·미저장 값·resume 이벤트가 유지되는지, 재생성 시 이전 WebView 해제와 새 renderer·브리지 응답이 정상인지 확인합니다. 관측용 WebView는 실제 `super.destroy()`를 실행하며 테스트에서 제품 대신 종료 처리를 수행하지 않습니다.

Android 단위 테스트 25개 suite·117개와 실제 `MainActivityInstrumentationTest` 12개가 통과했습니다. 종료·백그라운드·재생성 회귀와 기존 history·navigation 복원 검증을 포함합니다. 알림 표시 권한은 계측 프로세스 실행 전에 거부 상태로 준비했으며, 테스트 실행 중 권한 회수로 OS가 프로세스를 종료했던 준비 오류와 구분했습니다. 테스트 기대값이나 timeout은 완화하지 않았습니다.

운영 Web URL을 사용하는 v1.2.26(versionCode 28) release APK 빌드와 v2 서명을 확인했습니다.

수정 뒤 기존 기본 Native 성능 시나리오도 통과했습니다. 테스트의 명시적 WebView 정리를 사용하지 않고 제품 `onDestroy`만 실행했습니다. 동일한 AVD·production Web·Firebase Emulator 조건에서 홈 7회 원본은 **1087.8, 942.6, 938.3, 931.5, 968.2, 985.1, 954.0ms**입니다. 제외한 표본 없이 중앙값 **954.0ms**, 평균 **972.5ms**, 최대 **1087.8ms**였습니다. Quick Edit를 포함한 5개 지표·총 35개 본 표본이 모두 검증됐고 Firestore 10초 대기·WebChannel·해제된 WebView 오류는 관측되지 않았습니다.

수정 뒤 결과는 `web/performance-results/diagnostics/android-home-after-lifecycle-fix.json` 및 `.md`에 보존했습니다. 이 결과는 앞선 제품 수정 전 기준선을 덮지 않으며, 실제 휴대폰의 절대 로딩 시간을 보장하는 수치는 아닙니다.
