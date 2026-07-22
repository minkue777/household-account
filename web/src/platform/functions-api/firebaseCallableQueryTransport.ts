import { httpsCallable } from 'firebase/functions';
import type { HouseholdQueryTransport } from './householdQueryClient';
import {
  type HouseholdQueryEnvelope,
  type HouseholdQueryName,
  type HouseholdQueryOutcome,
  type HouseholdQueryResults,
  parseHouseholdQueryWireResponse,
} from './householdQueryContract';
import { getFidSafeFirebaseFunctions } from './fidSafeFirebaseFunctions';

export class FirebaseCallableQueryTransport implements HouseholdQueryTransport {
  async send<Name extends HouseholdQueryName>(
    envelope: HouseholdQueryEnvelope<Name>
  ): Promise<HouseholdQueryOutcome<HouseholdQueryResults[Name]>> {
    const callable = httpsCallable<HouseholdQueryEnvelope<Name>, unknown>(
      getFidSafeFirebaseFunctions(),
      'executeHouseholdQuery'
    );
    const response = await callable(envelope);
    return parseHouseholdQueryWireResponse<HouseholdQueryResults[Name]>(
      response.data,
      envelope.queryId
    );
  }
}
