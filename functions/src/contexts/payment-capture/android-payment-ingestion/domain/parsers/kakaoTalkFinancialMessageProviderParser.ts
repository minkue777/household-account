import type { AndroidProviderParseResult } from "../model/androidProviderParser";
import {
  bodyLines,
  ignoredParseFailure,
  type ProviderParserContext,
  type ProviderParserDefinition,
} from "./providerParsingSupport";
import { smsBillProviderParser } from "./smsBillProviderParser";

const KAKAO_TALK_PACKAGE = "com.kakao.talk";
const KAKAO_EXPORT_PREFIX =
  /^\[[^\]\r\n]{1,80}\]\s+\[(오전|오후)\s+(1[0-2]|0?[1-9]):[0-5]\d\]\s*/gmu;

function kakaoMessageBlocks(value: string): readonly string[] {
  const matches = [...value.matchAll(KAKAO_EXPORT_PREFIX)];
  if (matches.length === 0) {
    const normalized = bodyLines(value).join("\n");
    return normalized === "" ? [] : [normalized];
  }

  const blocks: string[] = [];
  const leading = value.slice(0, matches[0].index).trim();
  if (leading !== "") blocks.push(leading);

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    const block = bodyLines(value.slice(start, end)).join("\n");
    if (block !== "") blocks.push(block);
  }
  return blocks;
}

function distinctCandidates(context: ProviderParserContext): readonly string[] {
  const notification = context.notification;
  if (notification === undefined) return [context.body];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined): void => {
    const normalized = value?.trim() ?? "";
    if (normalized === "" || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  // Kakao MessagingStyle의 text는 현재 메시지이고, bigText/textLines는
  // 이전 메시지가 누적된 표시 본문일 수 있으므로 이 순서를 고정합니다.
  // 사용자 제어 title은 카드 증거로 쓰거나 body와 결합하지 않습니다.
  add(notification.text);
  add(notification.bigText);
  add(notification.textLines?.join("\n"));
  return candidates;
}

function parseKakaoCardMessage(
  context: ProviderParserContext,
): AndroidProviderParseResult {
  for (const candidate of distinctCandidates(context)) {
    const blocks = kakaoMessageBlocks(candidate);
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const result = smsBillProviderParser.parse({
        ...context,
        title: "",
        body: blocks[index],
      });
      if (result.kind === "Parsed" && result.payment !== undefined) {
        return { kind: "Parsed", payment: result.payment };
      }
    }
  }
  return ignoredParseFailure();
}

export const kakaoTalkFinancialMessageProviderParser: ProviderParserDefinition = {
  parserId: "kakao-talk-financial-message-parser",
  supportedPackages: [KAKAO_TALK_PACKAGE],
  parse: parseKakaoCardMessage,
};
