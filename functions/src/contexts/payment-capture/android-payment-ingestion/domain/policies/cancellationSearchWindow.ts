import type { CancellationSearchWindow } from "../model/cancellationMatch";
import { parseLocalDate, subtractCalendarDays } from "../value-objects/localDate";

export function buildCancellationSearchWindowPolicy(input: {
  readonly cancellationDate: string | null;
  readonly observedDate: string;
}): CancellationSearchWindow {
  const cancellationDate =
    input.cancellationDate === null
      ? undefined
      : parseLocalDate(input.cancellationDate);
  if (cancellationDate === undefined) {
    return {
      startDateInclusive: input.observedDate,
      endDateInclusive: input.observedDate,
    };
  }

  return {
    startDateInclusive: subtractCalendarDays(cancellationDate, 30),
    endDateInclusive: cancellationDate.value,
  };
}
