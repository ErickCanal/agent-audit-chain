import { computeHash } from './canonical';
import type { AuditEvent } from './types';

const GENESIS = '0'.repeat(64);

export interface AuditStore {
  append(e: Omit<AuditEvent, 'prevHash' | 'hash'>): AuditEvent;
  verify(tenantId: string): { ok: boolean; brokenAt?: string };
  list(tenantId: string): AuditEvent[];
}

export class MemoryAuditStore implements AuditStore {
  private chains = new Map<string, AuditEvent[]>();

  append(e: Omit<AuditEvent, 'prevHash' | 'hash'>): AuditEvent {
    const chain = this.chains.get(e.tenantId) ?? [];
    const prevHash = chain.length ? chain[chain.length - 1].hash : GENESIS;
    const unsealed = { ...e, prevHash };
    const event = { ...unsealed, hash: computeHash(unsealed) } as AuditEvent;
    chain.push(event);
    this.chains.set(e.tenantId, chain);
    return event;
  }

  verify(tenantId: string): { ok: boolean; brokenAt?: string } {
    const chain = this.chains.get(tenantId) ?? [];
    let prev = GENESIS;
    for (const ev of chain) {
      if (ev.prevHash !== prev) return { ok: false, brokenAt: ev.id };
      const { hash, ...rest } = ev;
      if (computeHash(rest) !== hash) return { ok: false, brokenAt: ev.id };
      prev = hash;
    }
    return { ok: true };
  }

  list(tenantId: string): AuditEvent[] {
    return [...(this.chains.get(tenantId) ?? [])];
  }
}
