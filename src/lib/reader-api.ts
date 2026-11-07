import { kindleStatus } from "@/lib/kindle-status";

// Derived fields the Read Later JSON routes add for the native app, which
// can't call the server helpers the web pages use.

export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 230));
}

export function withReadingMeta<
  T extends { wordCount: number; kindleSentAt: Date | null; kindleError: string | null },
>(item: T) {
  return { ...item, minutes: readingMinutes(item.wordCount), kindleStatus: kindleStatus(item) };
}

export const KINDLE_USER_SELECT = { kindleEmail: true, kindleAutoSend: true } as const;

// `autoSend` is the stored toggle; it only takes effect once an address is set.
export function kindleConfig(
  user: { kindleEmail: string | null; kindleAutoSend: boolean } | null,
): { configured: boolean; autoSend: boolean } {
  return { configured: Boolean(user?.kindleEmail), autoSend: user?.kindleAutoSend ?? false };
}
