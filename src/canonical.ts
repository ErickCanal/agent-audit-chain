import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

// Deterministic serialization: sorted keys, recursive, hash field excluded
export function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj as object).filter(k => k !== 'hash').sort();
  return '{' + keys.map(k =>
    JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k])
  ).join(',') + '}';
}

export function computeHash(event: object): string {
  return createHash('sha256').update(canonicalize(event)).digest('hex');
}