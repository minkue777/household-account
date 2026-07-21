import type { SmsCandidateSnapshot } from "../model/androidSmsCapture";

const REMOVAL_COUNTS = [0, 1, 2] as const;

export function generateSmsCandidates(
  rawBody: string,
): readonly SmsCandidateSnapshot[] {
  const lines = rawBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return REMOVAL_COUNTS.flatMap((removedLeadingLines) => {
    if (removedLeadingLines >= lines.length) return [];

    return [
      {
        ordinal: removedLeadingLines,
        removedLeadingLines,
        body: lines.slice(removedLeadingLines).join("\n"),
      },
    ];
  });
}
