export function normalizeKindleEmail(
  input: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (input === '') return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Email must be a string' };

  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: null };

  // Only the domain is case-insensitive; Amazon's Send-to-Kindle addresses
  // have mixed-case local parts, so keep that part exactly as typed.
  const at = trimmed.lastIndexOf('@');
  const email =
    at > 0 ? `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}` : trimmed;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (email.length > 254) return { ok: false, error: 'Email is too long.' };

  return { ok: true, value: email };
}
