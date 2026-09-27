import type { InsightSources } from "./dating-server";

/** Only recorded evidence can support a coverage claim; old summaries omit it. */
export function insightSourceLabel(sources?: InsightSources): string | null {
  if (!sources) return null;
  const read = sources.analyzedMessageSources ?? sources.messageSources;
  const count = (n: number) => n.toLocaleString("en-US");
  const imessage = read.imessage ?? 0;
  const whatsapp = read.whatsapp ?? 0;
  const parts = [
    `${count(imessage)} iMessage${imessage === 1 ? "" : "s"}`,
    `${count(whatsapp)} WhatsApp message${whatsapp === 1 ? "" : "s"}`,
    ...(read.paste ? [`${count(read.paste)} pasted message${read.paste === 1 ? "" : "s"}`] : []),
    `${count(sources.timelineCount)} timeline ${sources.timelineCount === 1 ? "entry" : "entries"}`,
    ...(sources.hasNotes ? ["your notes"] : []),
  ];
  const truncated = sources.analyzedMessageCount < sources.messageCount
    ? `. Read the newest ${count(sources.analyzedMessageCount)} of ${count(sources.messageCount)} saved messages.`
    : "";
  return `Based on ${parts.join(" · ")}${truncated}`;
}
