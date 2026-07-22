import { httpsCallable } from 'firebase/functions';
import {
  HouseholdCommandEnvelope,
  HouseholdCommandName,
  HouseholdCommandOutcome,
  HouseholdCommandResults,
  parseHouseholdCommandWireResponse,
} from './householdCommandContract';
import type { HouseholdCommandTransport } from './householdCommandClient';
import { getFidSafeFirebaseFunctions } from './fidSafeFirebaseFunctions';

const ENDPOINT = 'executeHouseholdCommand';

export class FirebaseCallableCommandTransport implements HouseholdCommandTransport {
  async send<Name extends HouseholdCommandName>(
    envelope: HouseholdCommandEnvelope<Name>
  ): Promise<HouseholdCommandOutcome<HouseholdCommandResults[Name]>> {
    const callable = httpsCallable<
      HouseholdCommandEnvelope<Name>,
      unknown
    >(getFidSafeFirebaseFunctions(), ENDPOINT);
    const response = await callable(envelope);
    return parseHouseholdCommandWireResponse<HouseholdCommandResults[Name]>(
      response.data,
      envelope.commandId
    );
  }
}
