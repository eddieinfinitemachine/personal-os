// Hosts where the private "EC" branding + Eddie-only data (Personal page,
// founder-only crons, etc.) are exposed. Anywhere else is the public
// multi-tenant EC.
export const PRIVATE_HOSTS = new Set(["internal.eddiecohen.com"]);

export function isPrivateHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const base = host.split(":")[0].toLowerCase();
  return PRIVATE_HOSTS.has(base);
}
