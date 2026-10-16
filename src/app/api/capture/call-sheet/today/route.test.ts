import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSheetEntry, CallSheetResponse } from "@/lib/call-sheet/types";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), getCallSheet: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/call-sheet/service", () => ({ getCallSheet: mocks.getCallSheet }));
import { GET } from "./route";

const req = () =>
  new Request("https://example.invalid/api/capture/call-sheet/today", {
    headers: { authorization: "Bearer token" },
  });
const entry = (overrides: Partial<CallSheetEntry>): CallSheetEntry => ({
  id: `e-${overrides.personId}`,
  personId: "p",
  name: "Someone",
  imageUrl: null,
  phone: "+15550100",
  email: null,
  reason: "Last talked 6 weeks ago",
  topic: null,
  lastContactAt: null,
  lastContactSource: null,
  status: "pending",
  cues: [],
  cadenceDays: 30,
  ...overrides,
});
const sheet: CallSheetResponse = {
  day: { id: "d1", localDate: "2026-10-16", version: 3 },
  entries: [
    entry({ personId: "p1", name: "Alex Rivera", reminder: { note: "ask about the move" } }),
    entry({ personId: "p2", name: "Sam", status: "done", method: "call" }),
    entry({ personId: "p3", name: "Jordan Lee", section: "birthday", birthday: "2026-10-16", reason: "" }),
    entry({ personId: "p 4", name: "Riley", status: "contacted" }),
  ],
  sources: {} as CallSheetResponse["sources"],
  timezone: "America/New_York",
  hidden: [],
  reviewCount: 2,
  upcoming: [],
  birthdays: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "https://os.example.com");
  mocks.auth.mockResolvedValue("owner");
  mocks.getCallSheet.mockResolvedValue(sheet);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/capture/call-sheet/today", () => {
  it("401s without the capture bearer", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getCallSheet).not.toHaveBeenCalled();
  });

  it("maps the call sheet into the fixed feed contract, birthdays first", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getCallSheet).toHaveBeenCalledWith("owner");
    expect(await res.json()).toEqual({
      date: "2026-10-16",
      items: [
        { personId: "p3", name: "Jordan Lee", reason: null, done: false, url: "https://os.example.com/friends?person=p3" },
        { personId: "p1", name: "Alex Rivera", reason: "Last talked 6 weeks ago", done: false, url: "https://os.example.com/friends?person=p1" },
        { personId: "p2", name: "Sam", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p2" },
        { personId: "p 4", name: "Riley", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p%204" },
      ],
    });
  });

  it("returns an empty list when nobody is on today's sheet", async () => {
    mocks.getCallSheet.mockResolvedValueOnce({ ...sheet, entries: [] });
    expect(await (await GET(req())).json()).toEqual({ date: "2026-10-16", items: [] });
  });

  it("uses the shared call-sheet failure response when the service throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getCallSheet.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not complete this action. Try again." });
    spy.mockRestore();
  });
});
