import { httpsCallable } from 'firebase/functions';
import type {
  AdminAccessEnvelope,
  AdminAccessOperation,
  AdminAccessOutcome,
  AdminAccessResults,
} from './adminAccessContract';
import { parseAdminAccessWireResponse } from './adminAccessContract';
import type { AdminAccessTransport } from './adminAccessClient';
import { getFidSafeFirebaseFunctions } from './fidSafeFirebaseFunctions';

export class FirebaseCallableAdminAccessTransport implements AdminAccessTransport {
  async send<Operation extends AdminAccessOperation>(
    envelope: AdminAccessEnvelope<Operation>
  ): Promise<AdminAccessOutcome<AdminAccessResults[Operation]>> {
    const callable = httpsCallable(getFidSafeFirebaseFunctions(), 'executeAdminAccess');
    const response = await callable(envelope);
    return parseAdminAccessWireResponse<AdminAccessResults[Operation]>(
      response.data,
      envelope.requestId
    );
  }
}
