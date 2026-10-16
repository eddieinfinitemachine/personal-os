import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSheetEntry, CallSheetResponse } from "@/lib/call-sheet/types";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCallSheet: vi.fn(),
  mutateCallSheet: vi.fn(),
  checkInUndoToken: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: mocks.auth }));
vi.mock("@/lib/call-sheet/service", () => ({
  getCallSheet: mocks.getCallSheet,
  mutateCallSheet: mocks.mutateCallSheet,
  checkInUndoToken: mocks.checkInUndoToken,
}));
import { IntakeError } from "@/lib/dating-intake/contracts";
import { GET, POST } from "./route";

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

describe("POST /api/capture/call-sheet/today", () => {
  const post = (body: unknown) =>
    new Request("https://example.invalid/api/capture/call-sheet/today", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const withStatus = (personId: string, status: CallSheetEntry["status"], version = 4): CallSheetResponse => ({
    ...sheet,
    day: { ...sheet.day, version },
    entries: sheet.entries.map((item) => (item.personId === personId ? { ...item, status } : item)),
  });
  const conflict = () => new IntakeError("The call sheet changed. Refresh it.", 409);

  it("401s without the capture bearer", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const res = await POST(post({ personId: "p1", done: true }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getCallSheet).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{"],
    ["an array", [{ personId: "p1", done: true }]],
    ["a missing personId", { done: true }],
    ["an empty personId", { personId: "", done: true }],
    ["a non-string personId", { personId: 7, done: true }],
    ["a non-boolean done", { personId: "p1", done: "yes" }],
    ["neither done nor replace", { personId: "p1" }],
    ["both done and replace", { personId: "p1", done: true, replace: true }],
    ["replace: false", { personId: "p1", replace: false }],
    ["an unknown field", { personId: "p1", done: true, method: "call" }],
  ])("400s on %s", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getCallSheet).not.toHaveBeenCalled();
    expect(mocks.mutateCallSheet).not.toHaveBeenCalled();
  });

  it("404s when the person isn't on today's sheet", async () => {
    for (const body of [{ personId: "nobody", done: true }, { personId: "nobody", replace: true }]) {
      const res = await POST(post(body));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not on today's call sheet" });
    }
    expect(mocks.mutateCallSheet).not.toHaveBeenCalled();
  });

  it("checks a pending entry in with method other and answers with the fresh feed", async () => {
    mocks.mutateCallSheet.mockResolvedValueOnce(withStatus("p1", "done"));
    const res = await POST(post({ personId: "p1", done: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.mutateCallSheet).toHaveBeenCalledExactlyOnceWith("owner", {
      dayId: "d1",
      version: 3,
      entryId: "e-p1",
      action: "done",
      method: "other",
    });
    expect(await res.json()).toEqual({
      date: "2026-10-16",
      items: [
        { personId: "p3", name: "Jordan Lee", reason: null, done: false, url: "https://os.example.com/friends?person=p3" },
        { personId: "p1", name: "Alex Rivera", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p1" },
        { personId: "p2", name: "Sam", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p2" },
        { personId: "p 4", name: "Riley", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p%204" },
      ],
    });
  });

  it("undoes a check-in through the sheet's undo slot when it is that person's", async () => {
    mocks.checkInUndoToken.mockResolvedValueOnce("tok-1");
    mocks.mutateCallSheet.mockResolvedValueOnce(withStatus("p2", "pending"));
    const res = await POST(post({ personId: "p2", done: false }));
    expect(res.status).toBe(200);
    expect(mocks.checkInUndoToken).toHaveBeenCalledWith("owner", "d1", "p2");
    expect(mocks.mutateCallSheet).toHaveBeenCalledExactlyOnceWith("owner", {
      dayId: "d1",
      version: 3,
      action: "undo",
      undoToken: "tok-1",
    });
    const body = await res.json();
    expect(body.items.find((item: { personId: string }) => item.personId === "p2").done).toBe(false);
  });

  it("409s an undo when the last change on the sheet was something else", async () => {
    mocks.checkInUndoToken.mockResolvedValue(null);
    const res = await POST(post({ personId: "p2", done: false }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Only the most recent call-sheet change can be undone." });
    expect(mocks.mutateCallSheet).not.toHaveBeenCalled();
    // A retry wouldn't change the answer, so it isn't attempted.
    expect(mocks.getCallSheet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["done: true on a done entry", "p2", true],
    ["done: true on a contacted entry", "p 4", true],
    ["done: false on a pending entry", "p1", false],
    ["done: false on a contacted entry", "p 4", false],
  ])("is a no-op 200 for %s", async (_label, personId, done) => {
    const res = await POST(post({ personId, done }));
    expect(res.status).toBe(200);
    expect(mocks.mutateCallSheet).not.toHaveBeenCalled();
    expect(mocks.checkInUndoToken).not.toHaveBeenCalled();
    expect(await res.json()).toEqual(await (await GET(req())).json());
  });

  it("re-reads and retries once on a version conflict", async () => {
    mocks.getCallSheet.mockResolvedValueOnce(sheet).mockResolvedValueOnce(withStatus("p3", "pending", 5));
    mocks.mutateCallSheet.mockRejectedValueOnce(conflict()).mockResolvedValueOnce(withStatus("p1", "done", 6));
    const res = await POST(post({ personId: "p1", done: true }));
    expect(res.status).toBe(200);
    expect(mocks.getCallSheet).toHaveBeenCalledTimes(2);
    expect(mocks.mutateCallSheet).toHaveBeenNthCalledWith(1, "owner", expect.objectContaining({ version: 3 }));
    expect(mocks.mutateCallSheet).toHaveBeenNthCalledWith(2, "owner", expect.objectContaining({ version: 5 }));
  });

  it("the retry re-decides from the fresh read (already done elsewhere: no second write)", async () => {
    mocks.getCallSheet.mockResolvedValueOnce(sheet).mockResolvedValueOnce(withStatus("p1", "done", 5));
    mocks.mutateCallSheet.mockRejectedValueOnce(conflict());
    const res = await POST(post({ personId: "p1", done: true }));
    expect(res.status).toBe(200);
    expect(mocks.mutateCallSheet).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.items.find((item: { personId: string }) => item.personId === "p1").done).toBe(true);
  });

  it("gives up with the service's 409 after one retry", async () => {
    mocks.mutateCallSheet.mockRejectedValue(conflict());
    const res = await POST(post({ personId: "p1", done: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "The call sheet changed. Refresh it." });
    expect(mocks.mutateCallSheet).toHaveBeenCalledTimes(2);
  });

  it("does not retry other failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.mutateCallSheet.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(post({ personId: "p1", done: true }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not complete this action. Try again." });
    expect(mocks.mutateCallSheet).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  describe("replace", () => {
    const swapped: CallSheetResponse = {
      ...sheet,
      day: { ...sheet.day, version: 4 },
      entries: sheet.entries.map((item) =>
        item.personId === "p1" ? entry({ personId: "p9", name: "Casey Kim", reason: "Last talked 3 months ago" }) : item,
      ),
    };

    it("swaps the person for someone else, as the web's 'Someone else today' does", async () => {
      mocks.mutateCallSheet.mockResolvedValueOnce(swapped);
      const res = await POST(post({ personId: "p1", replace: true }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.mutateCallSheet).toHaveBeenCalledExactlyOnceWith("owner", {
        dayId: "d1",
        version: 3,
        entryId: "e-p1",
        action: "replace",
      });
      expect(await res.json()).toEqual({
        date: "2026-10-16",
        items: [
          { personId: "p3", name: "Jordan Lee", reason: null, done: false, url: "https://os.example.com/friends?person=p3" },
          { personId: "p9", name: "Casey Kim", reason: "Last talked 3 months ago", done: false, url: "https://os.example.com/friends?person=p9" },
          { personId: "p2", name: "Sam", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p2" },
          { personId: "p 4", name: "Riley", reason: "Last talked 6 weeks ago", done: true, url: "https://os.example.com/friends?person=p%204" },
        ],
      });
    });

    it("re-reads and retries once on a version conflict", async () => {
      mocks.getCallSheet.mockResolvedValueOnce(sheet).mockResolvedValueOnce({ ...sheet, day: { ...sheet.day, version: 5 } });
      mocks.mutateCallSheet.mockRejectedValueOnce(conflict()).mockResolvedValueOnce(swapped);
      const res = await POST(post({ personId: "p1", replace: true }));
      expect(res.status).toBe(200);
      expect(mocks.mutateCallSheet).toHaveBeenNthCalledWith(2, "owner", {
        dayId: "d1",
        version: 5,
        entryId: "e-p1",
        action: "replace",
      });
      expect((await res.json()).items[1].personId).toBe("p9");
    });

    it("maps the service's no-one-else-due refusal to a 409 without retrying", async () => {
      const message = "No one else is due for a check-in right now, so Alex Rivera stays on today’s list.";
      mocks.mutateCallSheet.mockRejectedValueOnce(new IntakeError(message, 422));
      const res = await POST(post({ personId: "p1", replace: true }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: message });
      expect(mocks.mutateCallSheet).toHaveBeenCalledTimes(1);
    });
  });
});
