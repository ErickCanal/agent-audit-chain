import { describe, it, expect } from 'vitest';
import { canonicalize, computeHash } from './canonical';

describe('canonicalize', () => {
  it('is key-order independent', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
  it('excludes the hash field', () => {
    expect(canonicalize({ a: 1, hash: 'x' })).toBe(canonicalize({ a: 1 }));
  });
  it('breaks on any mutation', () => {
    const e = { actor: { id: 'u1' }, verb: 'tool.invoke' };
    const h = computeHash(e);
    expect(computeHash({ ...e, verb: 'tool.invoke2' })).not.toBe(h);
  });
});