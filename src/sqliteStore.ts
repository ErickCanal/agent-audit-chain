import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import initSqlJs, { type Database } from 'sql.js';
import { GENESIS, computeHash } from './canonical.js';
import type { AuditStore } from './store.js';
import type { AuditEvent } from './types.js';

export class SqliteAuditStore implements AuditStore {
  private constructor(private db: Database, private path: string) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_seq ON audit_events(tenant_id, seq);
    `);
  }

  static async open(path: string): Promise<SqliteAuditStore> {
    const SQL = await initSqlJs();
    const db = existsSync(path) ? new SQL.Database(readFileSync(path)) : new SQL.Database();
    return new SqliteAuditStore(db, path);
  }

  append(e: Omit<AuditEvent, 'prevHash' | 'hash'>): AuditEvent {
    const last = this.db.prepare(
      'SELECT hash FROM audit_events WHERE tenant_id = :tenantId ORDER BY seq DESC LIMIT 1'
    );
    last.bind({ ':tenantId': e.tenantId });
    const prevHash = last.step() ? (last.getAsObject()['hash'] as string) : GENESIS;
    last.free();

    const unsealed = { ...e, prevHash };
    const event = { ...unsealed, hash: computeHash(unsealed) } as AuditEvent;

    this.db.run(
      'INSERT INTO audit_events (tenant_id, hash, data) VALUES (:tenantId, :hash, :data)',
      { ':tenantId': e.tenantId, ':hash': event.hash, ':data': JSON.stringify(event) }
    );
    this.persist();
    return event;
  }

  verify(tenantId: string): { ok: boolean; brokenAt?: string } {
    const stmt = this.db.prepare(
      'SELECT data FROM audit_events WHERE tenant_id = :tenantId ORDER BY seq ASC'
    );
    stmt.bind({ ':tenantId': tenantId });
    let prev = GENESIS;
    while (stmt.step()) {
      const ev = JSON.parse(stmt.getAsObject()['data'] as string) as AuditEvent;
      if (ev.prevHash !== prev) {
        stmt.free();
        return { ok: false, brokenAt: ev.id };
      }
      const { hash, ...rest } = ev;
      if (computeHash(rest) !== hash) {
        stmt.free();
        return { ok: false, brokenAt: ev.id };
      }
      prev = hash;
    }
    stmt.free();
    return { ok: true };
  }

  list(tenantId: string): AuditEvent[] {
    const stmt = this.db.prepare(
      'SELECT data FROM audit_events WHERE tenant_id = :tenantId ORDER BY seq ASC'
    );
    stmt.bind({ ':tenantId': tenantId });
    const events: AuditEvent[] = [];
    while (stmt.step()) {
      events.push(JSON.parse(stmt.getAsObject()['data'] as string) as AuditEvent);
    }
    stmt.free();
    return events;
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private persist(): void {
    writeFileSync(this.path, Buffer.from(this.db.export()));
  }
}
