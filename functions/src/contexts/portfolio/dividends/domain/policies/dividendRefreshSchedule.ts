import type { DividendRefreshSchedule } from "../model/dividendRefreshJob";

export const DIVIDEND_REFRESH_SCHEDULE: DividendRefreshSchedule = {
  zoneId: "Asia/Seoul",
  cron: "0 9-20 * * *",
  dailyHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
};
