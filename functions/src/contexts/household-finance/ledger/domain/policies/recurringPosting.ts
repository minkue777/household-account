export interface RecurringLedgerPosting {
  readonly transactionId: string;
  readonly recurringPlanId: string;
  readonly recurringTargetMonth: string;
  readonly transactionType: "expense";
  readonly source: "recurring";
  readonly originChannel: "recurring";
  readonly creatorMemberId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly memo: string;
  readonly accountingDate: string;
}

export interface RecurringLedgerRecordedEvent {
  readonly eventType: "TransactionRecorded.v1";
  readonly eventId: string;
  readonly planId: string;
  readonly targetMonth: string;
  readonly transactionId: string;
}

/** 일정의 due 판정 이후 사용합니다. 저장은 호출한 Finance UoW가 원자적으로 수행합니다. */
export function prepareRecurringPosting(input: {
  readonly transactionId: string;
  readonly eventId: string;
  readonly planId: string;
  readonly targetMonth: string;
  readonly creatorMemberId: string;
  readonly merchant: string;
  readonly amountInWon: number;
  readonly categoryId: string;
  readonly memo: string;
  readonly accountingDate: string;
}): { readonly transaction: RecurringLedgerPosting; readonly event: RecurringLedgerRecordedEvent } {
  return {
    transaction: {
      transactionId: input.transactionId,
      recurringPlanId: input.planId,
      recurringTargetMonth: input.targetMonth,
      transactionType: "expense",
      source: "recurring",
      originChannel: "recurring",
      creatorMemberId: input.creatorMemberId,
      merchant: input.merchant,
      amountInWon: input.amountInWon,
      categoryId: input.categoryId,
      memo: input.memo,
      accountingDate: input.accountingDate,
    },
    event: {
      eventType: "TransactionRecorded.v1",
      eventId: input.eventId,
      planId: input.planId,
      targetMonth: input.targetMonth,
      transactionId: input.transactionId,
    },
  };
}
