import {
  FirebaseCallableCommandTransport,
  HouseholdCommandClient,
} from '@/platform/functions-api';
import { getClientSessionScope } from './clientSessionScope';

let commandClient: HouseholdCommandClient | undefined;

export function getHouseholdCommandClient(): HouseholdCommandClient {
  commandClient ??= new HouseholdCommandClient(
    new FirebaseCallableCommandTransport(),
    () => getClientSessionScope()?.householdId,
    () => getClientSessionScope()?.accessMode
  );
  return commandClient;
}

export function replaceHouseholdCommandClientForTest(client?: HouseholdCommandClient): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('명령 클라이언트 교체는 테스트 환경에서만 허용됩니다.');
  }
  commandClient = client;
}
