export const KINDLE_SENDING = "sending"

export function kindleStatus(item: {
  kindleSentAt: Date | string | null | undefined
  kindleError: string | null | undefined
}): "sent" | "sending" | "failed" | "none" {
  if (item.kindleSentAt) return "sent"
  if (item.kindleError === KINDLE_SENDING) return "sending"
  if (item.kindleError) return "failed"
  return "none"
}
