import type { DividendRefreshSchedule } from "../model/dividendRefreshJob";

export const DIVIDEND_REFRESH_SCHEDULE: DividendRefreshSchedule = {
  zoneId: "Asia/Seoul",
  cron: "0 19 * * *",
  dailyHours: [19],
};
