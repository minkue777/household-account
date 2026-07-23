"use strict";

// Firebase CLI가 함수를 탐색할 때는 target이 없으므로 전체 export를 공개합니다.
// 실제 Cloud Run 인스턴스에는 FUNCTION_TARGET이 있으므로 해당 함수의 bootstrap만
// 평가해 Android 결제 수집 cold start가 Shortcut 초기화 비용을 떠안지 않게 합니다.
const target = process.env.FUNCTION_TARGET || process.env.FUNCTION_NAME;

if (!target || target === "addExpenseFromMessage") {
  const shortcut = require("./lib/core/bootstrap/firebaseShortcutHttp.js");
  exports.addExpenseFromMessage = shortcut.addExpenseFromMessage;
}

if (
  !target ||
  target === "submitAndroidRawNotification" ||
  target === "submitCaptureEnvelope"
) {
  const capture = require("./lib/core/bootstrap/firebaseCaptureSubmission.js");
  exports.submitAndroidRawNotification = capture.submitAndroidRawNotification;
  exports.submitCaptureEnvelope = capture.submitCaptureEnvelope;
}
