import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: vi.fn() }));
vi.mock("./service", () => ({
  getCallSheet: vi.fn(),
  deletePersonWithCallSheetCleanup: vi.fn(),
  mutateCallSheet: vi.fn(),
  updateCallSheetSettings: vi.fn(),
  setCallSheetReminder: vi.fn(),
}));
vi.mock("./capture", () => ({
  getCaptureConfig: vi.fn(),
  captureCallSheet: vi.fn(),
}));
import { getCurrentUserId } from "@/lib/auth";
import { resolveCaptureUser } from "@/lib/capture-auth";
import {
  getCallSheet,
  deletePersonWithCallSheetCleanup,
  mutateCallSheet,
  updateCallSheetSettings,
  setCallSheetReminder,
} from "./service";
import { captureCallSheet, getCaptureConfig } from "./capture";
import { GET, POST } from "@/app/api/call-sheet/route";
import { DELETE as personDELETE } from "@/app/api/people/[id]/route";
import { POST as settingsPOST } from "@/app/api/call-sheet/settings/route";
import { POST as remindersPOST } from "@/app/api/call-sheet/reminders/route";
import {
  GET as captureGET,
  POST as capturePOST,
} from "@/app/api/capture/call-sheet/route";
describe("call sheet HTTP authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    vi.mocked(resolveCaptureUser).mockResolvedValue(null);
  });
  it("gates every UI and capture route without touching data, and returns private no-store", async () => {
    for (const handler of [
      GET,
      POST,
      settingsPOST,
      remindersPOST,
      captureGET,
      capturePOST,
    ]) {
      const response = await handler(
        new Request("http://localhost/api/call-sheet"),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    for (const service of [
      getCallSheet,
      deletePersonWithCallSheetCleanup,
      mutateCallSheet,
      updateCallSheetSettings,
      setCallSheetReminder,
      getCaptureConfig,
      captureCallSheet,
    ])
      expect(service).not.toHaveBeenCalled();
  });
  it("passes only the authenticated owner and rejects oversized JSON", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue("authenticated-owner");
    vi.mocked(getCallSheet).mockResolvedValue({ entries: [] } as never);
    expect(
      (
        await GET(
          new Request("http://localhost/api/call-sheet?userId=attacker"),
        )
      ).status,
    ).toBe(200);
    expect(getCallSheet).toHaveBeenCalledWith("authenticated-owner");
    const response = await POST(
      new Request("http://localhost/api/call-sheet", {
        method: "POST",
        body: JSON.stringify({ data: "a".repeat(4097) }),
      }),
    );
    expect(response.status).toBe(413);
    expect(mutateCallSheet).not.toHaveBeenCalled();
  });
  it("passes the reminder body for the authenticated owner and maps validation errors", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue("authenticated-owner");
    vi.mocked(setCallSheetReminder).mockResolvedValueOnce({ entries: [] } as never);
    const body = { personId: "p", dueOn: "2026-10-06", note: "lease" };
    const ok = await remindersPOST(
      new Request("http://localhost/api/call-sheet/reminders", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(setCallSheetReminder).toHaveBeenCalledWith("authenticated-owner", body);
    const { IntakeError } = await import("@/lib/dating-intake/contracts");
    vi.mocked(setCallSheetReminder).mockRejectedValueOnce(
      new IntakeError("That date has already passed"),
    );
    const bad = await remindersPOST(
      new Request("http://localhost/api/call-sheet/reminders", {
        method: "POST",
        body: JSON.stringify({ ...body, dueOn: "2020-01-01" }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "That date has already passed" });
  });
  it("routes authenticated person deletion through scoped snapshot cleanup", async () => {
    const request = new Request("http://localhost/api/people/person-id", {
      method: "DELETE",
    });
    const params = { params: Promise.resolve({ id: "person-id" }) };
    expect((await personDELETE(request, params)).status).toBe(401);
    expect(deletePersonWithCallSheetCleanup).not.toHaveBeenCalled();
    vi.mocked(getCurrentUserId).mockResolvedValue("authenticated-owner");
    vi.mocked(deletePersonWithCallSheetCleanup)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    expect((await personDELETE(request, params)).status).toBe(404);
    expect((await personDELETE(request, params)).status).toBe(200);
    expect(deletePersonWithCallSheetCleanup).toHaveBeenCalledWith(
      "authenticated-owner",
      "person-id",
    );
  });
});
