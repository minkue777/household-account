# Firebase 배포 smoke의 사용자 로그인 의존 제거

매번 가계부 Google 로그인을 준비하던 배포 절차를 변경합니다. 앱 사용자 인증과 운영자 GitHub·ADC 권한은 유지하며, 배포 도구의 기본 smoke에서만 사용자 세션을 요구하지 않습니다.

- 기본 실행: 기존 `executeHouseholdQuery`에 token 없이 실제 가구가 아닌 식별자로 요청합니다. 응답 계약·query ID·`AUTH_REQUIRED`·`retryable=false`와 공개 metadata의 release ID·commit SHA·artifact SHA를 정확히 확인합니다. 새 endpoint나 가구 데이터 공개는 없습니다.
- `--smoke-token-file` 지정: 기본 검사에 기존 실제 사용자 해석·가구 Query 성공 검사를 추가합니다. 명시한 token의 누락·만료·권한 실패는 그대로 실패하며 기본 검사로 대체하지 않습니다.
- 기본 smoke 성공은 실제 사용자 로그인·Membership·가구 조회 성공의 증거가 아닙니다. 이들 권한 계약은 기존 CI/Emulator/E2E에서 검증하고 필요한 운영 확인에는 선택적 인증 smoke를 사용합니다.
- 사용자 세션을 위조하거나 운영 가구·금융 데이터를 생성·수정하여 검사하지 않습니다. 기본 경로는 사람의 localhost 접속이나 Google 재로그인을 요구하지 않습니다.

기존 clean HEAD·build·artifact hash·actor·Secret·호환성 guard, deployment lease, 실패 provenance 보존, 독립 전체 CI는 유지합니다. provenance의 `DEPLOYMENT_AUTH_BOUNDARY_SMOKE`와 `USER_ACCESS_NOT_CHECKED`/`USER_ACCESS_CHECKED`로 검사 범위를 남깁니다. smoke 실패를 완료로 보고하거나 실패 기록을 덮지 않습니다. 예전의 로그인 준비·실패 기록은 당시 절차의 이력으로 보존하며 현재 실행은 [Firebase release runbook](firebase-release-runbook.md)을 따릅니다.

추적성: REL-004 / T-REL-004. 실행 코드와 검증 결과는 해당 변경의 commit·CI·배포 기록으로 확인합니다.

검증: 실제 Callable handler의 비로그인 응답은 수정 전 marker 누락으로 실패했고, 수정 후 가구 Membership·quota를 호출하지 않는 거부와 공개 marker 반환을 확인했습니다. 관련 wrapper·scope·Query 단위 검사 4파일 47개, Functions 타입 검사, 실제 Auth/Firestore/Functions Emulator의 Callable 통합 3개가 통과했습니다. 통합 검사는 기존 비로그인 거부와 인증된 가구 생성·지출 저장·조회 경로를 유지합니다. production build의 architecture 43개도 통과했습니다. 로그는 `%TEMP%/household-release-anonymous-{before,unit,types,callable}-20261015.log`에 보존합니다.
