---
name: notification-expense-audit
description: Household-account 프로젝트에서 notification_debug_logs의 카드/결제/청구 알림을 expenses와 대조해 소비 알림인데 지출로 등록되지 않은 항목을 찾고, 현재 Android 알림 파서가 처리 가능한 포맷인지 확인한 뒤, 미지원 포맷이면 파서와 테스트를 수정하고 한국어 커밋 메시지로 커밋 후 푸시해야 할 때 사용한다. 사용자가 "알림 원본에서 누락 지출 찾아줘", "소비 알림인데 지출이 없는 것 확인", "파서가 처리 못한 알림 수정", "최근 N일 알림 분석 후 커밋/푸시"처럼 요청하면 사용한다.
---

# Notification Expense Audit

## 목적

Household-account의 Android 알림 원본과 지출 DB를 감사해서 다음 순서로 처리합니다.

1. `notification_debug_logs`에서 대상 가계부/기간의 알림을 조회합니다.
2. 분명한 소비 승인/사용/결제/납부/청구 알림만 골라 `expenses`와 날짜, 금액, 가맹점, 시간 기준으로 대조합니다.
3. 지출이 없는 알림을 현재 Android 파서가 처리할 수 있는지 확인합니다.
4. 파서 미지원 포맷이면 parser와 테스트를 수정합니다.
5. 빌드/테스트 후 한국어 커밋 메시지로 커밋하고 푸시합니다.

## 기본 정보

- 익태네/익태송희네 householdId: `TVuRIWvPfF3qoAWChp09`
- 또니망고네 householdId: `ooZmqdvKQTkyvEPMERgs`
- 알림 원본 컬렉션: `notification_debug_logs`
- 지출 컬렉션: `expenses`
- 등록 카드 컬렉션: `registered_cards`
- Android 진입점: `android/app/src/main/java/com/household/account/service/CardNotificationListenerService.kt`
- Android 파서 위치: `android/app/src/main/java/com/household/account/parser`
- Android 파서 테스트 위치: `android/app/src/test/java/com/household/account/parser`

## 감사 스크립트

프로젝트 루트에서 실행합니다.

```powershell
node .codex\skills\notification-expense-audit\scripts\audit_missing_expenses.js --household iktae --days 21
```

주요 옵션:

- `--household iktae|ttoni-mango|<householdId>`: 대상 가계부입니다. 기본값은 `iktae`입니다.
- `--days 21`: 종료일 포함 최근 N일입니다.
- `--from YYYY-MM-DD --to YYYY-MM-DD`: 기간을 직접 지정합니다.
- `--credentials <service-account.json>`: ADC가 없을 때 사용할 Firebase 서비스 계정 JSON입니다.
- `--json`: Markdown 대신 JSON으로 출력합니다.

스크립트는 DB를 수정하지 않습니다. Firestore 인증은 Firebase Admin 기본 인증(ADC), `GOOGLE_APPLICATION_CREDENTIALS`, 또는 `--credentials`를 사용합니다. `functions/node_modules/firebase-admin`이 없으면 먼저 `npm --prefix functions install`을 실행합니다.

## 판정 절차

1. 스크립트 출력의 `Missing spending notifications`를 확인합니다.
2. `parser`가 `no-parser`이거나 `debug-only`이면 새 parser가 필요할 가능성이 큽니다.
3. `parser`가 기존 parser 파일을 가리키는데도 누락이면 해당 parser의 `matches()`와 `parse()`가 실제 원문 포맷을 통과하는지 확인합니다.
4. `registeredCard`가 `no-match`이면 카드 미등록으로 저장이 막힌 것일 수 있습니다. 이 경우 파서 문제가 아니라 등록 카드 데이터 문제인지 먼저 판단합니다.
5. `reason`이 `parser-format-or-save-blocked`이면 파서 실패, 카드 등록 실패, 중복 방지 조건 불일치 중 하나입니다. 원문, parser, `CardNotificationListenerService.saveExpenseAndLaunchQuickEdit()` 흐름을 같이 확인합니다.

## 파서 수정 지침

- 기존 parser가 있는 소스면 새 클래스를 만들지 말고 해당 parser에 포맷 분기를 추가합니다.
- 신규 카드사/앱이면 parser를 추가하고 `CardNotificationListenerService.detectSource()`와 `resolveDebugLogSource()` 연결을 확인합니다.
- 원문 하나만 겨냥한 과도한 정규식보다 같은 앱의 변형을 2~3개 흡수할 수 있는 패턴을 우선합니다.
- 취소/승인취소/매출취소는 지출 생성이 아니라 취소 흐름으로 보내야 합니다.
- 캐시백, 할인, 포인트 문구가 섞인 토스 알림은 작은 캐시백 금액이 아니라 실제 결제 금액을 추출해야 합니다.
- 카드 등록 검증이 필요한 일반 카드 알림은 `cardLastFour`가 등록 카드와 매칭될 수 있게 `카드사(1234)` 또는 기존 포맷에 맞춰 저장합니다.
- 도시가스 청구서처럼 카드 결제 알림이 아닌 청구 알림은 기존 `CityGasBillParser` 규칙과 메모/카드사 생략 정책을 유지합니다.

## 검증

변경 범위에 맞게 실행합니다.

```powershell
./gradlew.bat :app:testDebugUnitTest
./gradlew.bat :app:assembleDebug
```

웹/Functions를 건드렸을 때만 추가로 실행합니다.

```powershell
npm --prefix web run build
npm --prefix functions run build
```

테스트가 기존 환경 문제로 실패하면 실패 원인과 실제 변경 관련성을 최종 보고에 적습니다.

## 커밋과 푸시

파서 수정이 끝나고 검증이 끝나면 전체 변경사항을 확인한 뒤 한국어 커밋 메시지로 커밋하고 푸시합니다.

```powershell
git status --short
git diff --stat
git add <changed-files>
git commit -m "알림 파서 누락 포맷 처리"
git push
```

커밋에는 감사 스킬 자체 수정과 파서 수정이 섞이지 않게 하는 편이 좋습니다. 사용자가 "전체 변경사항 커밋"을 요구하면 그 지시를 우선합니다.
