# agent-audit-chain

A tamper-evident audit log for AI agents, written in TypeScript.

When an AI agent calls tools on someone's behalf, you need a reliable record of what it did: who acted, what they tried, and whether it was allowed. This library records those actions as a **hash chain**, so if anyone edits or removes an earlier record, `verify()` detects it and reports which event was changed.

## How it works

Each event stores the hash of the event before it, and its own hash covers everything in it, including that link:

```
GENESIS (64 zeros)
   │
   ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ event 1             │    │ event 2             │    │ event 3             │
│ prevHash: 000…000   │ ◄──│ prevHash: hash(1)   │ ◄──│ prevHash: hash(2)   │
│ hash: sha256(1)     │    │ hash: sha256(2)     │    │ hash: sha256(3)     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

Change one field in event 1, and its hash no longer matches, so verification fails at that event. Even if the attacker recomputes event 1's hash, event 2's `prevHash` no longer matches it, so the break is still detected.

**Canonical hashing** (`src/canonical.ts`): before hashing, an event is serialized with its keys sorted at every level and its `hash` field left out. The same event always produces the same SHA-256 hash, no matter the order its fields were written in.

**One chain per tenant**: each `tenantId` has its own chain. One customer's events never affect another's, and each can be verified on its own.

**Payload digests, not payloads**: an event stores a `digest` of the agent's input or output plus a `redactionLevel`, rather than the raw content. Sensitive data stays out of the audit log, while the digest still proves what the content was.

### Event shape

```ts
interface AuditEvent {
  id: string;
  tenantId: string;
  actor:   { type: 'agent' | 'user' | 'system'; id: string };
  action:  { verb: string; resource: string; outcome: 'allowed' | 'denied' };
  payload: { digest: string; redactionLevel: 'none' | 'partial' | 'full' };
  timestamp: string;  // ISO 8601
  prevHash: string;   // set by the store
  hash: string;       // set by the store
}
```

### Stores

Both stores implement the same `AuditStore` interface: `append(event)`, `verify(tenantId)` and `list(tenantId)`.

| Store | File | Use |
|---|---|---|
| `MemoryAuditStore` | `src/store.ts` | In memory. Tests and prototypes. |
| `SqliteAuditStore` | `src/sqliteStore.ts` | SQLite (via [sql.js](https://sql.js.org/)), saved to a file after every append. Survives restarts. |

## Usage

```ts
import { SqliteAuditStore } from './src/sqliteStore.js';

const store = await SqliteAuditStore.open('audit.db');

store.append({
  id: crypto.randomUUID(),
  tenantId: 'acme',
  actor:   { type: 'agent', id: 'support-bot' },
  action:  { verb: 'refund.create', resource: 'urn:example:tool:payments', outcome: 'denied' },
  payload: { digest: 'sha256:9f2c…', redactionLevel: 'full' },
  timestamp: new Date().toISOString(),
});

store.verify('acme');  // { ok: true }
// after someone edits a row in audit.db:
// { ok: false, brokenAt: '<id of the first bad event>' }

store.close();
```

## Run the tests

Requires Node.js 20+.

```bash
npm install
npm test            # 12 tests (vitest)
npx tsc --noEmit    # type-check
```

The tests cover key-order-independent hashing, chain linking, tenant isolation, persistence across reopening the database file, and detecting a record that was edited directly on disk.

## Known issues

- **Double recording.** Some tool calls were recorded twice because the host agent framework emitted the same call twice; the bug is in the host, not this library. But events have no `toolCallId`, so the store can't tell a repeated emit from a new action: `append()` adds two events with different `id`s, and the chain still verifies. Planned fix: add a `toolCallId` field, enforce it as unique per tenant (`UNIQUE (tenant_id, tool_call_id)` in SQLite), and make `append()` idempotent, returning the existing event when the same call is recorded again.
- **Replay duplicates.** In production use, some events were recorded again with the same payload digest but a different event id, minutes to days later. This is separate from the double-recording issue and the cause is still unknown. Deduping on payload digest would also drop legitimate repeated calls, so the planned fix is an idempotency key (`toolCallId`) supplied by the caller.

## Limitations

- **Removing events from the end isn't detected.** A hash chain proves the events that are there haven't changed, but if the newest events are deleted, the shorter chain still verifies. Fixing this needs an outside anchor, such as periodically publishing or signing the latest hash.
- **No signatures.** Someone with write access to the database could rebuild the whole chain from scratch with valid hashes. Signing each event, or the chain head, would prevent that.
- **Single writer.** Two processes appending to the same tenant at once could both link to the same previous event and fork the chain.
- **The SQLite store rewrites the whole database file on every append.** That's fine for small logs, but slow for large ones, and a crash during the write can corrupt the file.
- **Verification re-reads the whole chain** for a tenant each time.

## Roadmap

1. `toolCallId` idempotency: a caller-supplied key, unique per tenant, so recording the same tool call again returns the existing event instead of appending a duplicate (see Known issues).
2. Sign the chain head (Ed25519) and export it regularly, so truncation and full rewrites can be detected.
3. Swap sql.js for a native SQLite driver with transactions, so appends are atomic and incremental.
4. Checkpoints, so verification can start from the last verified event instead of the beginning.
5. A small HTTP API and middleware that records every agent tool call automatically.
6. An export format that an outside auditor can verify with a standalone script.
