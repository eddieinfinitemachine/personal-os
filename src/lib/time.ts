// Compact relative-time label for comment threads etc.
// "now" / "5m" / "3h" / "2d" / "Apr 3" / "Apr 3, 2025".
export function timeAgo(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 45) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
