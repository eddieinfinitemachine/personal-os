# Dating: paragraph entry and source-aware history

## Behavior

Add person begins with a paragraph, then an editable review. The original text stays in notes. The prepare route is read-only, owner-scoped, and uses exact full-name CRM contact matches; it does not guess a phone, Instagram username, or an exact meeting date. First-name-only matches never borrow another profile's details. Pursuing replaces the display label Talking (stored value remains `talking`).

New profiles with notes generate a summary after saving. The existing Mac message sync resolves missing handles from its saved Contacts export only when one full name maps to one contact and one dating profile. It never uploads the address book. Concurrent automatic resolutions are serialized per owner, and existing manual handles are preserved. The cache is `~/Library/Application Support/personal-os/contacts.json`; its date is logged. It is a saved export, not a live Contacts connection; new or changed Mac contacts need the existing exporter refreshed separately.

Message imports refresh derived insights once per person after both sources. A failed generation retains previous insights and is retried on subsequent sync. Historic backfills use import time to invalidate summaries. Insights preserve source coverage, including explicit zero WhatsApp counts and truncated message windows. Open profiles poll saved results without making model calls or overwriting manual edits. The analysis remains bounded to newest 3,000 messages / 80,000 characters plus existing timeline and notes.

## Instagram limitation

The hosted app has no persistent personal Instagram connection. Paragraph handles, exact saved CRM social links, and separately verified browser lookups are usable. Signing in on this Mac does not connect that session to Vercel. No scraping service, cookie extraction, or Instagram message import was implemented. Eddie's new request authorizes relevant account lookups; earlier historical handoff prohibitions on all Instagram lookup are superseded to that extent.

## WhatsApp

Phone-only matching previously ignored privacy-ID (`@lid`) conversations. Optional ContactsV2 mapping must require explicit, unambiguous WhatsApp identity records; never match a display name or interpret privacy-ID digits as a phone. Missing/unsupported mappings retain direct-phone matching. Diagnostics use snapshots, schema metadata, and exact-target counts without message content or unrelated identifiers.

Operational flags: `--person-id=ID` scopes contact resolution, import and summary work; empty IDs fail closed. `--diagnose-whatsapp` adds schema/count diagnostics. `--dry-run` prevents writes. Original worktree and production credentials must not be used for tests. No schema changes.

Newly matched WhatsApp identities trigger a full backfill before incremental sync resumes. A local atomic checkpoint records only SHA256 keys tied to destination/profile/contact evidence, after all import batches succeed. Missing/corrupt/failed checkpoints retry safely; a crash-orphaned lock can cause repeated deduplicated backfills until its stale lock is removed. No new server schema is needed.

Verification: 523 tests passed, including owner/auth/concurrency tests on isolated PostgreSQL; 22 unrelated opt-in database tests skipped. Typecheck and production build passed. Two invented-person browser flows verified grounded extraction, unknown dates/contacts, mobile 390px fit, save/navigation, and automatic first summary with actual source coverage. No production verification fixtures were created. Deployment and live targeted WhatsApp verification are recorded separately after release.
