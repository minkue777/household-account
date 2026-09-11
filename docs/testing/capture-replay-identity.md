# 수집 재시도 identity 검증

전체 Firebase E2E의 `T-CAN-004`에서 실제 결함이 드러났습니다. 최초 Android 승인 후 가맹점 규칙을 바꾸고 같은 원문·observation ID를 재전송하면, 새 규칙의 가맹점·카테고리가 receipt hash를 바꾸어 `IDEMPOTENCY_PAYLOAD_MISMATCH`가 발생했습니다. 이전 설정 캐시가 이 차이를 잠시 숨기고 있었습니다.

운영 Ledger adapter는 저장 결과를 만들기 위한 설정 파생값과 입력 identity를 분리합니다.

- Android raw ingress는 실제 `Sha256AndroidRawNotificationHasher`로 전체 입력을 hash합니다. 이 서버 계산값만 내부 `verifiedRawPayloadHash`로 전달하며 root/ledger receipt는 가구·멱등 key·생성자·원문 hash를 명시적으로 결박합니다. parser 버전이나 파생값은 이 identity에 포함하지 않습니다.
- 공개 typed envelope의 `rawPayloadHash`는 호출자가 제공하므로 서버 검증 원문과 구분합니다. 이 경로는 원 가맹점·금액·시각·원 카드 증거·parser·actor 등 명시된 입력 사실도 함께 결박합니다. 가맹점 규칙 및 카드 설정의 표시 결과는 입력이 아닙니다.
- `verifiedRawPayloadHash`와 `verifiedRawInput`은 공개 wire 필드가 아닙니다. 실제 bootstrap decoder 테스트는 양쪽 공개 endpoint에서 이 필드를 추가하면 업무 Application 호출 없이 `UNKNOWN_FIELD`로 거부함을 검증합니다.

구형 receipt는 기존 전체 command hash가 정확히 일치할 때 계속 재생합니다. 이미 저장된 구형 hash만으로는 설정이나 parser가 바뀐 뒤 원 입력을 보편적으로 복원할 수 없으므로 추측해서 성공 처리하지 않습니다. 구형 receipt·동일 입력 재생과 변경된 원문 거부를 함께 검증합니다. 새 receipt는 version을 구별한 입력 fingerprint를 저장하며 마이그레이션 쓰기나 추가 데이터 조회는 없습니다.

검증 대상은 유효한 인증·입력 검증을 통과해 receipt 경계에 도착한 재시도입니다. 새 parser가 입력 자체를 거부하는 경우까지 이전 결과를 무조건 재생하는 변경은 아닙니다.

실제 adapter 테스트는 최초 승인/중복/취소 결과 재생, 원문·actor 변경 거부, 서버 parser 결과 변경, 구형 fingerprint 호환 및 저장소 무변경을 확인합니다. 2026-09-11 관련 8개 파일 97개가 통과했고, 이어 추가한 root receipt 2개를 포함한 해당 파일 24개와 Functions 타입 검사도 통과했습니다. 이후 Functions 품질 게이트 1,699개와 architecture 39개가 통과했습니다. 최종 소스로 다시 빌드한 실제 Firebase 3개 codebase 및 production Web 전체 E2E 실행에서도 `payment-capture.spec.ts`의 `T-CAN-004`가 통과해, 설정 변경·사용자 편집·취소 이후 동일 원문 재전송의 실제 서버 결과 재생을 확인했습니다. 이 기록은 해당 시나리오의 통과를 뜻하며 전체 E2E 완료 결과는 별도로 기록합니다.
