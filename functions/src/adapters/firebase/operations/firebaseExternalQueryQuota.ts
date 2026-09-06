import { createHash } from 'node:crypto';
import type * as firestore from 'firebase-admin/firestore';

/** Hash-only rolling ingress buckets; rejected attempts do not spend provider work. */
export class FirebaseExternalQueryQuota {
  constructor(private readonly database: firestore.Firestore, private readonly now: () => number = Date.now,
    private readonly limits = { principal: 120, ip: 600, windowMs: 60_000 }) {}
  async allow(input: { principalUid: string; householdId: string; sourceIp?: string }): Promise<boolean> {
    const now = this.now();
    const identities = [{ key: 'principal:' + input.principalUid + ':' + input.householdId, maximum: this.limits.principal },
      ...(input.sourceIp ? [{ key: 'ip:' + input.sourceIp, maximum: this.limits.ip }] : [])];
    const targets = identities.map(identity => ({ ...identity, ref: this.database.collection('operations').doc('runtime').collection('externalQueryQuotas').doc(createHash('sha256').update(identity.key).digest('hex')) }));
    return this.database.runTransaction(async transaction => {
      const snapshots = await Promise.all(targets.map(target => transaction.get(target.ref)));
      const next = targets.map((target, index) => {
        const previous = snapshots[index].data();
        const resetAt = typeof previous?.resetAt === 'number' && previous.resetAt > now ? previous.resetAt : now + this.limits.windowMs;
        const used = typeof previous?.resetAt === 'number' && previous.resetAt > now && Number.isSafeInteger(previous.used) ? previous.used : 0;
        return { ...target, resetAt, used: used + 1 };
      });
      if (next.some(target => target.used > target.maximum)) return false;
      next.forEach(target => transaction.set(target.ref, { used: target.used, resetAt: target.resetAt, expiresAt: new Date(target.resetAt + 24 * 60 * 60 * 1000), schemaVersion: 1 }));
      return true;
    });
  }
}
