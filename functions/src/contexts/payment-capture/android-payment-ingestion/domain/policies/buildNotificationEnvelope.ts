import type {
  NotificationEnvelopeResult,
  RawNotificationInput,
} from "../model/notificationIngress";

function optionalText(value: string | null | undefined): string {
  return value ?? "";
}

function selectedBody(input: RawNotificationInput): string {
  const lines = (input.textLines ?? [])
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length > 0) return lines.join("\n");

  const bigText = optionalText(input.bigText);
  if (bigText.trim() !== "") return bigText;

  const text = optionalText(input.text);
  return text.trim() === "" ? "" : text;
}

export function buildNotificationEnvelope(
  input: RawNotificationInput,
): NotificationEnvelopeResult {
  const title = optionalText(input.title);
  const body = selectedBody(input);
  const parseText = [title, body]
    .filter((value) => value.trim() !== "")
    .join("\n")
    .trim();

  return parseText === ""
    ? { kind: "Ignored", code: "EMPTY_NOTIFICATION" }
    : {
        kind: "Built",
        envelope: {
          packageName: input.packageName,
          postedAt: input.postedAt,
          selectedBody: body,
          parseText,
        },
      };
}
