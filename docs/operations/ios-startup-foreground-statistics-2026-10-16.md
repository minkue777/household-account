# iPhone 첫 화면 통계의 백그라운드 표본 제외

## 요구사항과 관측

사용자는 iPhone 첫 화면의 이상 로그를 제거해 정상 기록만 보도록 요청했고, 이번 분석뿐 아니라 관리자 통계에도 제외 기준을 적용하는 것으로 선택했습니다. ADM-005·006 / T-ADM-005의 관리자 성능 집계에 적용합니다.

2026-10-16 01시 KST 무렵 최근 24시간의 iPhone 첫 화면 로그는 5건입니다. 16,774ms 표본 1건에 `hiddenMs=4131`, `hiddenCount=1`이 있습니다. 이 표본은 초기 로그인 대기와 Membership 해석도 포함하고 있어 백그라운드 4,131ms만 빼 정상 실행으로 간주하지 않습니다. 정상 전경 4건은 3,030 / 3,142 / 3,294 / 2,543ms이며 평균 3,002.25ms, 최대·nearest-rank P95 3,294ms입니다. 이 중 최신 Web 059eee27의 정상 2건은 평균 3,086ms입니다. 표본 수가 적고 Web 버전이 달라 성능 개선 폭으로 해석하지 않습니다.

## 입력·결과·실패·저장 계약

- 입력은 기존 Cloud Logging `interactive-latency.v1` total 로그입니다. `clientStartup` endpoint의 `client.ios-pwa-first-home-complete-paint.v1` operation에만 새 기준을 적용합니다.
- 기존 v1 진단 normalizer로 유효한 진단을 해석합니다. `initialVisibility=hidden`, `hiddenMs>0`, `hiddenCount>0` 중 하나면 해당 표본을 관리자 호출·결과 수와 평균·P95·최대·최근 시각에서 모두 제외합니다.
- 경과 시간 자체의 cutoff나 사건별 timestamp/insertId 예외를 두지 않습니다. 느린 전경 실행은 그대로 유지합니다. 초기 관측 전 숨김 여부를 추측하거나 `duration-hiddenMs`를 정상 실행 시간으로 만들지 않습니다.
- 진단 없는 구버전·손상되어 해석할 수 없는 부가 진단에는 새 제외 기준을 적용하지 않습니다. Android·Functions·알림 지표도 유지합니다. 진단 미확인을 정상 전경이 검증된 것으로 해석하지 않습니다.
- 해당 기간이 전부 제외 표본이면 정상 0초 행을 만들지 않습니다. Cloud Logging 조회 실패·페이지 제한의 기존 error/partial 상태는 유지합니다.
- 원본 Cloud 로그는 보존합니다. 접속 Command·사용자 접속 횟수·원장·기타 업무 자료를 수정하거나 삭제하지 않습니다. 기존 로그에도 조회 시 바로 적용되며 별도 백필은 없습니다.

## 구현과 검증

집계 입력 경계인 `GoogleCloudInteractiveLatencyReader.observation`에서 기존 진단 normalizer와 조건 하나로 제외합니다. 별도 제외 목록·저장소·DTO·UI 상태는 추가하지 않습니다.

- 실제 Cloud Logging 7일치 13건을 읽어 최근 24시간의 5건/제외 1건/유지 4건을 확인했습니다. 로컬 원본은 `%TEMP%/household-ios-startup-review-20261016.json`입니다.
- 새 회귀는 수정 전 4개 실패를 확인했습니다. 숨김 시작·숨김 시간·숨김 전환 횟수, 전부 제외, 느린 전경·구버전·손상 진단·Android 보존을 검증합니다.
- reader·실제 logger·진단 normalizer 관련 3개 파일 135개가 통과했습니다.

## 배포 범위

Functions 실행 코드 변경이며 세 codebase를 기존 wrapper로 배포합니다. Web·APK 변경은 없습니다. 실제 배포 marker·인증 경계 smoke와 최종 SHA의 CI는 각각 확인합니다.
