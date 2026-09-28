import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/capture-auth", () => ({ resolveCaptureUser: vi.fn() }));
vi.mock("./service", () => ({
  getCallSheet: vi.fn(),
  mutateCallSheet: vi.fn(),
  updateCallSheetSettings: vi.fn(),
}));
vi.mock("./capture", () => ({
  getCaptureConfig: vi.fn(),
  captureCallSheet: vi.fn(),
}));
import { getCurrentUserId } from "@/lib/auth";
import { resolveCaptureUser } from "@/lib/capture-auth";
import {
  getCallSheet,
  mutateCallSheet,
  updateCallSheetSettings,
} from "./service";
import { captureCallSheet, getCaptureConfig } from "./capture";
import { GET, POST } from "@/app/api/call-sheet/route";
import { POST as settingsPOST } from "@/app/api/call-sheet/settings/route";
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
    for (const handler of [GET, POST, settingsPOST, captureGET, capturePOST]) {
      const response = await handler(
        new Request("http://localhost/api/call-sheet"),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    for (const service of [
      getCallSheet,
      mutateCallSheet,
      updateCallSheetSettings,
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
});
