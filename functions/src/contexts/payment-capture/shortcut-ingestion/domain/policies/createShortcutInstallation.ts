import type {
  ShortcutDefinition,
  ShortcutInstallation,
} from "../model/shortcutCredentialStorageInstaller";

export function createShortcutInstallation<const Endpoint extends string>(
  endpoint: Endpoint,
): ShortcutInstallation<Endpoint> {
  const definition: ShortcutDefinition<Endpoint> = {
    endpoint,
    method: "POST",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer {{importQuestion.shortcutCredential}}",
      "Idempotency-Key": "{{shortcut.executionId}}",
    },
    body: {
      contractVersion: "shortcut-payment.v1",
      message: "{{shortcut.input.paymentMessage}}",
    },
    responseHandling: "ShowTypedPaymentCaptureResult",
    importQuestions: [
      {
        id: "shortcutCredential",
        prompt: "복사한 Shortcut 인증키를 붙여넣으세요",
        secret: true,
      },
    ],
  };

  return {
    definition,
    actions: ["CopyCredential", "OpenInstallLink"],
    automationGuidance: {
      trigger: "PersonalPaymentMessage",
      action: "RunInstalledShortcut",
      setup: "UserConnectsOnceOnDevice",
    },
  };
}
