import { describe, expect, it } from "vitest";
import { insightSourceLabel } from "./dating-insight-sources";

describe("summary source coverage", () => {
  it("makes absent WhatsApp evidence explicit and includes saved notes", () => {
    expect(insightSourceLabel({ messageCount: 15, analyzedMessageCount: 15, messageSources: { imessage: 15 },
      timelineCount: 0, hasNotes: true, newestMessageImportedAt: null })).toBe("Based on 15 iMessages · 0 WhatsApp messages · 0 timeline entries · your notes");
  });
  it("reports only analyzed source counts when a thread was truncated", () => {
    expect(insightSourceLabel({ messageCount: 4000, analyzedMessageCount: 3000,
      messageSources: { imessage: 3000, whatsapp: 1000 }, analyzedMessageSources: { imessage: 3000 },
      timelineCount: 1, hasNotes: false, newestMessageImportedAt: null })).toBe("Based on 3,000 iMessages · 0 WhatsApp messages · 1 timeline entry. Read the newest 3,000 of 4,000 saved messages.");
  });
  it("makes no coverage claim for summaries created before coverage was recorded", () => {
    expect(insightSourceLabel(undefined)).toBeNull();
  });
});
