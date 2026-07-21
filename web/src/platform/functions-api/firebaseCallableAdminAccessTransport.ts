import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '@/lib/firebase';
import type {
  AdminAccessEnvelope,
  AdminAccessOperation,
  AdminAccessOutcome,
  AdminAccessResults,
} from './adminAccessContract';
import { parseAdminAccessWireResponse } from './adminAccessContract';
import type { AdminAccessTransport } from './adminAccessClient';

export class FirebaseCallableAdminAccessTransport implements AdminAccessTransport {
  async send<Operation extends AdminAccessOperation>(
    envelope: AdminAccessEnvelope<Operation>
  ): Promise<AdminAccessOutcome<AdminAccessResults[Operation]>> {
    const callable = httpsCallable(getFunctions(app, 'asia-northeast3'), 'executeAdminAccess');
    const response = await callable(envelope);
    return parseAdminAccessWireResponse<AdminAccessResults[Operation]>(
      response.data,
      envelope.requestId
    );
  }
}
