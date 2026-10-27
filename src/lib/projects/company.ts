// Which company a /projects card belongs to. Rules run in order on the repo
// or project name (and the repo owner), so an `olto-*` repo that lives under
// the Infinite-Machine org still files under Olto.

export const COMPANY_ORDER = ["Infinite Machine", "Olto", "Silo", "Walden", "Personal"] as const;
export type Company = (typeof COMPANY_ORDER)[number];

/**
 * One-line fixes for a misfiled card, keyed by repo ("owner/name") or by name
 * (repo name or personal-os Project name). Matched case-insensitively.
 */
export const COMPANY_OVERRIDES: Record<string, Company> = {};

export function isCompany(value: unknown): value is Company {
  return typeof value === "string" && (COMPANY_ORDER as readonly string[]).includes(value);
}

export function companyFor(
  { name, owner }: { name: string; owner?: string | null },
  overrides: Record<string, Company> = COMPANY_OVERRIDES,
): Company {
  const lowered = new Map(Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v]));
  const n = name.trim().toLowerCase();
  const o = owner?.trim().toLowerCase() ?? "";
  const override = (o && lowered.get(`${o}/${n}`)) || lowered.get(n);
  if (override) return override;

  if (n.includes("olto")) return "Olto";
  if (n.includes("silo")) return "Silo";
  if (n.includes("walden") || o === "waldenmeditation") return "Walden";
  if (
    o === "infinite-machine" ||
    /^im-/.test(n) ||
    /infinite[- ]?machine/.test(n) ||
    // "c2" as its own token, so "ec2-tools" or "abc2" stay Personal.
    /(^|[^a-z0-9])c2([^a-z0-9]|$)/.test(n)
  ) {
    return "Infinite Machine";
  }
  return "Personal";
}
