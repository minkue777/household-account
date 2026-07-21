import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import {
  HouseholdCommandEnvelope,
  HouseholdCommandName,
  HouseholdCommandOutcome,
  HouseholdCommandResults,
  parseHouseholdCommandWireResponse,
} from './householdCommandContract';
import type { HouseholdCommandTransport } from './householdCommandClient';

const REGION = 'asia-northeast3';
const ENDPOINT = 'executeHouseholdCommand';

export class FirebaseCallableCommandTransport implements HouseholdCommandTransport {
  async send<Name extends HouseholdCommandName>(
    envelope: HouseholdCommandEnvelope<Name>
  ): Promise<HouseholdCommandOutcome<HouseholdCommandResults[Name]>> {
    const callable = httpsCallable<
      HouseholdCommandEnvelope<Name>,
      unknown
    >(getFunctions(app, REGION), ENDPOINT);
    const response = await callable(envelope);
    return parseHouseholdCommandWireResponse<HouseholdCommandResults[Name]>(
      response.data,
      envelope.commandId
    );
  }
}
