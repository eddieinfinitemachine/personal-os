import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));
import { sendMagicLinkEmail } from "./email";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "test-key");
  mocks.send.mockResolvedValue({ data: { id: "m1" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

const sentText = () => mocks.send.mock.calls[0][0].text as string;

describe("sendMagicLinkEmail", () => {
  it("links to verify on the request's host", async () => {
    await sendMagicLinkEmail("eddie@example.com", "abc", "https://os.example.invalid/");
    expect(sentText()).toContain("https://os.example.invalid/api/auth/verify?token=abc\n");
    expect(sentText()).not.toContain("client=");
  });

  it("marks the link for the app when client is app", async () => {
    await sendMagicLinkEmail("eddie@example.com", "abc", "https://os.example.invalid", "app");
    expect(sentText()).toContain("https://os.example.invalid/api/auth/verify?token=abc&client=app\n");
    expect(mocks.send.mock.calls[0][0].html).toContain("verify?token=abc&client=app");
  });
});
