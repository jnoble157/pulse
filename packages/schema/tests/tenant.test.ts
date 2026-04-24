import { describe, it, expect } from 'vitest';
import { isUuid } from '../src/tenant.js';

describe('isUuid', () => {
  it('accepts canonical v4 UUIDs', () => {
    expect(isUuid('c4ca4238-a0b9-4823-8c6e-1e39f8c0d8b4')).toBe(true);
  });
  it('rejects non-uuids', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid("'; drop table calls; --")).toBe(false);
  });
});
