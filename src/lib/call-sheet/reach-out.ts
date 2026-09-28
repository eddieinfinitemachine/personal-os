/** Uses existing Interaction fields; channel detail stays in the title. */
export const REACH_OUT_METHODS = {
  call: { label: "Call", kind: "call", title: "Called" },
  text: { label: "Text", kind: "message", title: "Texted" },
  whatsapp: { label: "WhatsApp", kind: "message", title: "Messaged on WhatsApp:" },
  email: { label: "Email", kind: "message", title: "Emailed" },
  in_person: { label: "In person", kind: "meeting", title: "Met with" },
  other: { label: "Other", kind: "other", title: "Checked in with" },
} as const;
export type ReachOutMethod = keyof typeof REACH_OUT_METHODS;
export function isReachOutMethod(value: unknown): value is ReachOutMethod {
  return typeof value === "string" && Object.hasOwn(REACH_OUT_METHODS, value);
}
