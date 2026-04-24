import { describe, expect, test } from 'vitest';
import { sanitizeNextPath } from '../app/gate/sanitize-next';

describe('sanitizeNextPath', () => {
  test('keeps safe internal paths', () => {
    expect(sanitizeNextPath('/')).toBe('/');
    expect(sanitizeNextPath('/gate?next=/')).toBe('/gate?next=/');
    expect(sanitizeNextPath('/demo/path')).toBe('/demo/path');
  });

  test('rejects external or malformed redirects', () => {
    expect(sanitizeNextPath('https://evil.test')).toBe('/');
    expect(sanitizeNextPath('//evil.test')).toBe('/');
    expect(sanitizeNextPath('javascript:alert(1)')).toBe('/');
    expect(sanitizeNextPath('/\\evil')).toBe('/');
  });
});
