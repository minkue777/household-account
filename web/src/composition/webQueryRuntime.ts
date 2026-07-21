import {
  FirebaseCallableQueryTransport,
  HouseholdQueryClient,
} from '@/platform/functions-api';
import { getClientSessionScope } from './clientSessionScope';

let queryClient: HouseholdQueryClient | undefined;

export function getHouseholdQueryClient(): HouseholdQueryClient {
  queryClient ??= new HouseholdQueryClient(
    new FirebaseCallableQueryTransport(),
    () => getClientSessionScope()?.householdId
  );
  return queryClient;
}
