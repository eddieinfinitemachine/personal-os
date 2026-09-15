export function kindleStatus(item: {
  kindleSentAt: Date | string | null | undefined
  kindleError: string | null | undefined
}): "sent" | "sending" | "failed" | "none" {
  if (item.kindleSentAt) return "sent"
  if (item.kindleError === "sending") return "sending"
  if (item.kindleError) return "failed"
  return "none"
}
