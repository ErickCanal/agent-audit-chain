import { describe, it, expect } from 'vitest';
import { MemoryAuditStore } from './store.js';

const evt = (tenantId: string, verb: string) => ({
  id: crypto.randomUUID(), tenantId,
  actor: { type: 'agent' as const, id: 'a1' },
  action: { verb, resource: 'urn:openclaw:tool:test', outcome: 'allowed' as const },
  payload: { digest: 'd', redactionLevel: 'none' as const },
  timestamp: new Date().toISOString(),
});

describe('MemoryAuditStore', () => {
  it('links the chain', () => {
    const s = new MemoryAuditStore();
    const a = s.append(evt('t1', 'one'));
    const b = s.append(evt('t1', 'two'));
    expect(b.prevHash).toBe(a.hash);
  });
  it('verifies a clean chain', () => {
    const s = new MemoryAuditStore();
    s.append(evt('t1', 'one')); s.append(evt('t1', 'two'));
    expect(s.verify('t1').ok).toBe(true);
  });
  it('detects tampering', () => {
    const s = new MemoryAuditStore();
    s.append(evt('t1', 'one')); s.append(evt('t1', 'two'));
    (s.list('t1'), (s as any).chains.get('t1')[0].action.verb = 'evil');
    expect(s.verify('t1').ok).toBe(false);
  });
  it('isolates tenants', () => {
    const s = new MemoryAuditStore();
    s.append(evt('t1', 'one')); s.append(evt('t2', 'one'));
    expect(s.list('t1')).toHaveLength(1);
    expect(s.verify('t2').ok).toBe(true);
  });
});