import { describe, it, expect } from 'vitest';
import { formatPiiToken, PII_TOKEN_RE, PiiEntrySchema } from '../src/pii.js';

describe('PII token format', () => {
  it('matches the documented shape', () => {
    expect(formatPiiToken('guest', 1)).toBe('<GUEST_1>');
    expect(formatPiiToken('phone', 27)).toBe('<PHONE_27>');
    expect(formatPiiToken('card', 0)).toBe('<CARD_0>');
  });

  it('PII_TOKEN_RE finds tokens in a sentence', () => {
    const text = 'Hi <GUEST_1>, your <PHONE_2> is on file. <CARD_3> declined.';
    const matches = text.match(PII_TOKEN_RE);
    expect(matches).toEqual(['<GUEST_1>', '<PHONE_2>', '<CARD_3>']);
  });

  it('PiiEntrySchema rejects malformed tokens', () => {
    expect(() =>
      PiiEntrySchema.parse({
        token: 'not-a-token',
        category: 'guest',
        original: 'Alice',
        first_turn_index: 0,
        first_offset: 3,
      }),
    ).toThrow();
  });
});
