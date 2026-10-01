import { beforeEach, describe, expect, it, vi } from "vitest";
const prisma = vi.hoisted(() => ({
  callSheetSettings: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("./resolve-person", async (original) => ({
  ...(await original<typeof import("./resolve-person")>()),
  resolveOrCreatePerson: vi.fn(),
}));
vi.mock("./service", async (original) => ({
  ...(await original<typeof import("./service")>()),
  setCallSheetReminder: vi.fn(),
}));
import { commitCallSheetProposal, formatReminderDate } from "./reminder-capture";
import { resolveOrCreatePerson } from "./resolve-person";
import { setCallSheetReminder } from "./service";

const now = new Date("2026-09-29T01:00:00Z"); // Mon Sep 28, 9pm in New York
const proposal = {
  type: "call_sheet" as const,
  firstName: "Grace",
  lastName: "Kotick",
  date: "2026-10-06",
  note: " the lease ",
};
beforeEach(() => {
  vi.clearAllMocks();
  prisma.callSheetSettings.findUnique.mockResolvedValue({ timezone: "America/New_York" });
});
describe("commitCallSheetProposal", () => {
  it("resolves the person and sets the reminder with a friendly message", async () => {
    vi.mocked(resolveOrCreatePerson).mockResolvedValue({
      kind: "match",
      person: { id: "grace", firstName: "Grace", lastName: "Kotick" },
    });
    const result = await commitCallSheetProposal("owner", proposal, now);
    expect(setCallSheetReminder).toHaveBeenCalledWith(
      "owner",
      { personId: "grace", dueOn: "2026-10-06", note: "the lease" },
      now,
    );
    expect(result).toEqual({
      ok: true,
      personId: "grace",
      name: "Grace Kotick",
      dueOn: "2026-10-06",
      note: "the lease",
      created: false,
      message: "Grace Kotick will be on your call sheet Tue, Oct 6",
    });
  });
  it("says 'today' in the sheet's timezone, not UTC", async () => {
    vi.mocked(resolveOrCreatePerson).mockResolvedValue({
      kind: "created",
      person: { id: "new", firstName: "Grace Dayan", lastName: null },
    });
    const result = await commitCallSheetProposal(
      "owner",
      { ...proposal, date: "2026-09-28", note: null },
      now,
    );
    expect(result).toMatchObject({
      ok: true,
      created: true,
      message: "Grace Dayan is on your call sheet today",
    });
  });
  it("returns the candidates for an ambiguous name and never sets a reminder", async () => {
    vi.mocked(resolveOrCreatePerson).mockResolvedValue({
      kind: "ambiguous",
      candidates: [
        { id: "a", firstName: "Grace Dayan", lastName: null },
        { id: "b", firstName: "Grace", lastName: "Kotick" },
      ],
    });
    const result = await commitCallSheetProposal(
      "owner",
      { ...proposal, lastName: null },
      now,
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        "More than one person is called Grace: Grace Dayan, Grace Kotick. Use their full name.",
      candidates: ["Grace Dayan", "Grace Kotick"],
    });
    expect(setCallSheetReminder).not.toHaveBeenCalled();
  });
  it("rejects a past or malformed date before creating anyone", async () => {
    for (const date of ["2026-09-27", "Tuesday", "2028-12-01"]) {
      const result = await commitCallSheetProposal("owner", { ...proposal, date }, now);
      expect(result.ok).toBe(false);
    }
    expect(
      await commitCallSheetProposal("owner", { ...proposal, firstName: " " }, now),
    ).toMatchObject({ ok: false, status: 400 });
    expect(resolveOrCreatePerson).not.toHaveBeenCalled();
  });
  it("formats dates without timezone drift", () => {
    expect(formatReminderDate("2026-10-06")).toBe("Tue, Oct 6");
    expect(formatReminderDate("2027-01-01")).toBe("Fri, Jan 1");
  });
});
