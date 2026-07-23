"use strict";

const capture = require("./lib/core/bootstrap/firebaseCaptureSubmission.js");
const shortcut = require("./lib/core/bootstrap/firebaseShortcutHttp.js");

exports.addExpenseFromMessage = shortcut.addExpenseFromMessage;
exports.submitAndroidRawNotification = capture.submitAndroidRawNotification;
exports.submitCaptureEnvelope = capture.submitCaptureEnvelope;
