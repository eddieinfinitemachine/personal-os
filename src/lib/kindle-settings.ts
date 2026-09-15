export function normalizeKindleEmail(
  input: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (input === '') return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'Email must be a string' };

  const email = input.trim().toLowerCase();
  if (email === '') return { ok: true, value: null };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (email.length > 254) return { ok: false, error: 'Email is too long.' };

  return { ok: true, value: email };
}
