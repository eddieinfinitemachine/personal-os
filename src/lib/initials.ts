// Best-effort initials for the personalized app name. The product is a generic
// "Personal OS"; a signed-in person's installed copy is branded with their
// initials instead. Callers fall back to "Personal OS" when this returns "".
export function initials(name?: string | null, email?: string | null): string {
  const n = (name ?? "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    // Single-token name → its first letter (true initial).
    return parts[0][0]?.toUpperCase() ?? "";
  }
  const local = (email ?? "").split("@")[0].replace(/[^a-zA-Z]/g, "");
  return local ? local[0].toUpperCase() : "";
}
