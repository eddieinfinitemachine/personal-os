import { describe, it, expect } from 'vitest';
import { normalizeKindleEmail } from './kindle-settings';

describe('normalizeKindleEmail', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeKindleEmail(null)).toEqual({ ok: true, value: null });
    expect(normalizeKindleEmail(undefined)).toEqual({ ok: true, value: null });
  });

  it('returns null for empty string', () => {
    expect(normalizeKindleEmail('')).toEqual({ ok: true, value: null });
    expect(normalizeKindleEmail('  ')).toEqual({ ok: true, value: null });
  });

  it('trims and lowercases only the domain', () => {
    const result = normalizeKindleEmail('  Test@Example.COM  ');
    expect(result).toEqual({ ok: true, value: 'Test@example.com' });
  });

  it('keeps the mixed-case local part of a Kindle address', () => {
    expect(normalizeKindleEmail('emcohen_b4Nyzs@Kindle.com')).toEqual({
      ok: true,
      value: 'emcohen_b4Nyzs@kindle.com',
    });
  });

  it('rejects invalid email', () => {
    expect(normalizeKindleEmail('not-an-email')).toEqual({ ok: false, error: expect.any(String) });
    expect(normalizeKindleEmail('no@domain')).toEqual({ ok: false, error: expect.any(String) });
  });

  it('rejects email longer than 254 chars', () => {
    const long = 'a'.repeat(250) + '@example.com';
    expect(normalizeKindleEmail(long)).toEqual({ ok: false, error: expect.any(String) });
  });

  it('rejects non-string input', () => {
    expect(normalizeKindleEmail(123)).toEqual({ ok: false, error: expect.any(String) });
  });
});
