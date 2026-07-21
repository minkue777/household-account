import type {
  SelectSmsParserInput,
  SmsParserOrderResult,
} from "../../../domain/model/smsParserOrder";

export interface SmsParserOrderInputPort {
  select(input: SelectSmsParserInput): SmsParserOrderResult;
}
