import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAuditStore } from './sqliteStore.js';

const evt = (tenantId: string, verb: string) => ({
  id: crypto.randomUUID(), tenantId,
  actor: { type: 'agent' as const, id: 'a1' },
  action: { verb, resource: 'urn:openclaw:tool:test', outcome: 'allowed' as const },
  payload: { digest: 'd', redactionLevel: 'none' as const },
  timestamp: new Date().toISOString(),
});

let dir: string;
const dbPath = () => {
  dir = mkdtempSync(join(tmpdir(), 'openclaw-audit-'));
  return join(dir, 'audit.sqlite');
};

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('SqliteAuditStore', () => {
  it('links the chain', async () => {
    const s = await SqliteAuditStore.open(dbPath());
    const a = s.append(evt('t1', 'one'));
    const b = s.append(evt('t1', 'two'));
    expect(b.prevHash).toBe(a.hash);
    s.close();
  });

  it('verifies a clean chain', async () => {
    const s = await SqliteAuditStore.open(dbPath());
    s.append(evt('t1', 'one')); s.append(evt('t1', 'two'));
    expect(s.verify('t1').ok).toBe(true);
    s.close();
  });

  it('isolates tenants', async () => {
    const s = await SqliteAuditStore.open(dbPath());
    s.append(evt('t1', 'one')); s.append(evt('t2', 'one'));
    expect(s.list('t1')).toHaveLength(1);
    expect(s.verify('t2').ok).toBe(true);
    s.close();
  });

  it('persists across reopening the same file', async () => {
    const path = dbPath();
    const s1 = await SqliteAuditStore.open(path);
    s1.append(evt('t1', 'one'));
    s1.append(evt('t1', 'two'));
    s1.close();

    const s2 = await SqliteAuditStore.open(path);
    expect(s2.list('t1')).toHaveLength(2);
    expect(s2.verify('t1').ok).toBe(true);
    s2.close();
  });

  it('detects tampering even when edited directly on disk', async () => {
    const path = dbPath();
    const s1 = await SqliteAuditStore.open(path);
    s1.append(evt('t1', 'one'));
    s1.append(evt('t1', 'two'));
    s1.close();

    const s2 = await SqliteAuditStore.open(path);
    (s2 as any).db.run("UPDATE audit_events SET data = json_set(data, '$.action.verb', 'evil') WHERE seq = 1");
    expect(s2.verify('t1').ok).toBe(false);
    s2.close();
  });
});
