import { describe, expect, it } from "vitest";
import {
  createNotificationIngressDriver,
  type NotificationIngressInputPort,
  type RawNotificationInput,
} from "../../../support/notification-ingress-driver";

export interface NotificationIngressContractSubject
  extends NotificationIngressInputPort {}

export function createSubject(): NotificationIngressContractSubject {
  return createNotificationIngressDriver();
}

const rawNotification = (
  overrides: Partial<RawNotificationInput> = {},
): RawNotificationInput => ({
  packageName: "com.example.card",
  postedAt: "2026-07-20T10:00:00+09:00",
  title: "카드 승인",
  text: "기본 본문",
  bigText: "확장 본문",
  textLines: ["첫 행", "둘째 행"],
  ...overrides,
});

describe("Android 알림 envelope·30초 process 중복 공개 계약", () => {
  it("[T-ING-001][ING-001] textLines를 우선 본문으로 사용하고 제목을 parseText 첫 줄에 둔다", () => {
    const result = createSubject().buildEnvelope(rawNotification());

    expect(result).toEqual({
      kind: "Built",
      envelope: {
        packageName: "com.example.card",
        postedAt: "2026-07-20T10:00:00+09:00",
        selectedBody: "첫 행\n둘째 행",
        parseText: "카드 승인\n첫 행\n둘째 행",
      },
    });
  });

  it.each([
    {
      name: "textLines가 비면 bigText",
      input: rawNotification({
        textLines: [],
        bigText: "확장 본문",
        text: "기본 본문",
      }),
      selectedBody: "확장 본문",
    },
    {
      name: "textLines와 bigText가 비면 text",
      input: rawNotification({
        textLines: [],
        bigText: "  ",
        text: "기본 본문",
      }),
      selectedBody: "기본 본문",
    },
  ])(
    "[T-ING-001][ING-001] $name 순서로 본문을 선택한다",
    ({ input, selectedBody }) => {
      const result = createSubject().buildEnvelope(input);

      expect(result).toMatchObject({
        kind: "Built",
        envelope: { selectedBody, parseText: `카드 승인\n${selectedBody}` },
      });
    },
  );

  it("[T-ING-001][ING-001] 제목과 모든 본문 후보가 비면 EMPTY_NOTIFICATION으로 끝낸다", () => {
    const result = createSubject().buildEnvelope(
      rawNotification({ title: " ", text: null, bigText: "", textLines: [] }),
    );

    expect(result).toEqual({ kind: "Ignored", code: "EMPTY_NOTIFICATION" });
  });

  it.each([
    { elapsed: 29_999, expected: "Duplicate" },
    { elapsed: 30_000, expected: "Duplicate" },
    { elapsed: 30_001, expected: "Accepted" },
  ] as const)(
    "[T-ING-002][ING-004] 최초 처리 후 $elapsed ms 입력은 $expected 결과다",
    ({ elapsed, expected }) => {
      const subject = createSubject();
      const key = {
        packageName: "com.example.card",
        parseText: "승인\n10,000원",
      };

      expect(
        subject.claimRecent({ ...key, receivedAtMilliseconds: 1_000 }),
      ).toEqual({ kind: "Accepted" });
      const result = subject.claimRecent({
        ...key,
        receivedAtMilliseconds: 1_000 + elapsed,
      });

      expect(result).toEqual(
        expected === "Accepted"
          ? { kind: "Accepted" }
          : { kind: "Duplicate", ageInMilliseconds: elapsed },
      );
      expect(subject.state()).toEqual({
        recentEntries: [
          {
            ...key,
            acceptedAtMilliseconds:
              expected === "Accepted" ? 1_000 + elapsed : 1_000,
          },
        ],
      });
    },
  );

  it("[T-ING-002][ING-004] process 재시작 뒤에는 같은 package·본문도 다시 처리한다", () => {
    const subject = createSubject();
    const input = {
      packageName: "com.example.card",
      parseText: "승인\n10,000원",
      receivedAtMilliseconds: 1_000,
    };
    subject.claimRecent(input);

    subject.restartProcess();

    expect(
      subject.claimRecent({ ...input, receivedAtMilliseconds: 2_000 }),
    ).toEqual({ kind: "Accepted" });
    expect(subject.state()).toEqual({
      recentEntries: [
        {
          packageName: "com.example.card",
          parseText: "승인\n10,000원",
          acceptedAtMilliseconds: 2_000,
        },
      ],
    });
  });

  it("[T-ING-001][ING-001] textLines의 빈 행을 제거하고 각 행의 앞뒤 공백을 정규화한다", () => {
    const result = createSubject().buildEnvelope(
      rawNotification({ textLines: ["  첫 행  ", "   ", " 둘째 행 "] }),
    );

    expect(result).toMatchObject({
      kind: "Built",
      envelope: {
        selectedBody: "첫 행\n둘째 행",
        parseText: "카드 승인\n첫 행\n둘째 행",
      },
    });
  });

  it.each([
    {
      name: "제목 없이 본문만 있음",
      input: rawNotification({
        title: null,
        textLines: [],
        bigText: null,
        text: "본문만 존재",
      }),
      selectedBody: "본문만 존재",
      parseText: "본문만 존재",
    },
    {
      name: "본문 없이 제목만 있음",
      input: rawNotification({
        title: "제목만 존재",
        textLines: [],
        bigText: null,
        text: null,
      }),
      selectedBody: "",
      parseText: "제목만 존재",
    },
  ])(
    "[T-ING-001][ING-001] $name 입력도 비어 있지 않은 envelope로 만든다",
    ({ input, selectedBody, parseText }) => {
      expect(createSubject().buildEnvelope(input)).toMatchObject({
        kind: "Built",
        envelope: { selectedBody, parseText },
      });
    },
  );

  it.each([
    {
      name: "package가 다름",
      second: {
        packageName: "com.example.other-card",
        parseText: "승인\n10,000원",
      },
    },
    {
      name: "parseText가 다름",
      second: {
        packageName: "com.example.card",
        parseText: "승인\n20,000원",
      },
    },
  ])(
    "[T-ING-002][ING-004] $name 경우에는 별도 process 중복 key로 수용한다",
    ({ second }) => {
      const subject = createSubject();
      subject.claimRecent({
        packageName: "com.example.card",
        parseText: "승인\n10,000원",
        receivedAtMilliseconds: 1_000,
      });

      expect(
        subject.claimRecent({ ...second, receivedAtMilliseconds: 2_000 }),
      ).toEqual({ kind: "Accepted" });
      expect(subject.state().recentEntries).toHaveLength(2);
    },
  );

  it("[T-ING-002][ING-004] 중복 재입력은 최초 수용 시각부터 계산하는 30초 창을 연장하지 않는다", () => {
    const subject = createSubject();
    const key = {
      packageName: "com.example.card",
      parseText: "승인\n10,000원",
    };
    subject.claimRecent({ ...key, receivedAtMilliseconds: 1_000 });

    expect(
      subject.claimRecent({ ...key, receivedAtMilliseconds: 30_999 }),
    ).toEqual({ kind: "Duplicate", ageInMilliseconds: 29_999 });
    expect(
      subject.claimRecent({ ...key, receivedAtMilliseconds: 31_001 }),
    ).toEqual({ kind: "Accepted" });
    expect(subject.state()).toEqual({
      recentEntries: [
        { ...key, acceptedAtMilliseconds: 31_001 },
      ],
    });
  });
});
