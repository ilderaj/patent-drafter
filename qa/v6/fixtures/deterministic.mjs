import { createHash } from 'node:crypto';

export const FIXED_NOW = '2026-10-30T12:00:00.000Z';

export function createDeterministicClock(start = FIXED_NOW) {
  let current = Date.parse(start);
  if (!Number.isFinite(current)) throw new TypeError(`Invalid clock start: ${start}`);
  return {
    now: () => new Date(current).toISOString(),
    advance: (milliseconds) => {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
        throw new TypeError('Clock advance must be a non-negative safe integer');
      }
      current += milliseconds;
      return new Date(current).toISOString();
    },
  };
}

export function createDeterministicIds(namespace = 'v6-fixture') {
  let sequence = 0;
  return (label = 'id') => {
    sequence += 1;
    const digest = createHash('sha256').update(`${namespace}:${label}:${sequence}`).digest('hex');
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  };
}

export function createDualTenantFixture() {
  const nextId = createDeterministicIds('v6-02-dual-tenant');
  const tenantA = nextId('tenant-a');
  const tenantB = nextId('tenant-b');
  const actorA = nextId('actor-a');
  const actorB = nextId('actor-b');
  const matterA = nextId('matter-a');
  const matterB = nextId('matter-b');

  return Object.freeze({
    tenants: Object.freeze([
      Object.freeze({ id: tenantA, actorId: actorA, matterId: matterA, title: 'Synthetic matter A' }),
      Object.freeze({ id: tenantB, actorId: actorB, matterId: matterB, title: 'Synthetic matter B' }),
    ]),
    sessions: Object.freeze([
      Object.freeze({ actorId: actorA, tenantId: tenantA }),
      Object.freeze({ actorId: actorB, tenantId: tenantB }),
    ]),
    resourceFor: (session, resourceId) => {
      const tenant = [tenantA, tenantB].find((id) => id === session.tenantId);
      const matter = [matterA, matterB].find((id) => id === resourceId);
      return tenant && matter && ((tenant === tenantA && matter === matterA) || (tenant === tenantB && matter === matterB))
        ? { id: matter, tenantId: tenant }
        : null;
    },
  });
}
