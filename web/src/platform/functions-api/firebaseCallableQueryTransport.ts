import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import type { HouseholdQueryTransport } from './householdQueryClient';
import {
  type HouseholdQueryEnvelope,
  type HouseholdQueryName,
  type HouseholdQueryOutcome,
  type HouseholdQueryResults,
  parseHouseholdQueryWireResponse,
} from './householdQueryContract';

const REGION = 'asia-northeast3';

export class FirebaseCallableQueryTransport implements HouseholdQueryTransport {
  async send<Name extends HouseholdQueryName>(
    envelope: HouseholdQueryEnvelope<Name>
  ): Promise<HouseholdQueryOutcome<HouseholdQueryResults[Name]>> {
    const callable = httpsCallable<HouseholdQueryEnvelope<Name>, unknown>(
      getFunctions(app, REGION),
      'executeHouseholdQuery'
    );
    const response = await callable(envelope);
    return parseHouseholdQueryWireResponse<HouseholdQueryResults[Name]>(
      response.data,
      envelope.queryId
    );
  }
}
