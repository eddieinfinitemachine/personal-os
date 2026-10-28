import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { getThreadMeta, listThreads, type GmailThreadMeta } from "@/lib/google";
import { createGate } from "./gate";
import { GMAIL_QUERY, addressesIn, collectEmails } from "./gmail";

const ME = "me@im.example";
const mine = new Set([ME, "alias@im.example"]);
const gate = () =>
  createGate({ datingNames: ["Jordan"], familyNames: [], blockedEmails: new Set(["crush@example.invalid"]), datingNoteIds: new Set() });

const msg = (id: string, at: number, headers: Record<string, string>, snippet = "") => ({
  id,
  internalDate: String(at),
  snippet,
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
});
const thread = (id: string, messages: ReturnType<typeof msg>[]): GmailThreadMeta => ({ id, messages });

const THREADS: Record<string, GmailThreadMeta> = {
  work: thread("work", [
    msg("1", 1000, { Subject: "ERP cutover plan", From: `Eddie <${ME}>`, To: "Ops <ops@vendor.example>" }, "Draft attached"),
    msg("2", 2000, { Subject: "Re: ERP cutover plan", From: "ops@vendor.example", To: ME, Cc: "fin@vendor.example" }, "Looks good &amp; thanks"),
  ]),
  rsvp: thread("rsvp", [msg("3", 1000, { Subject: "Accepted: Weekly sync @ Tue", From: ME, To: "x@acme.example" })]),
  invite: thread("invite", [msg("4", 1000, { Subject: "Updated invitation: Board", From: ME, To: "x@acme.example" })]),
  self: thread("self", [msg("5", 1000, { Subject: "note to self", From: ME, To: "alias@im.example" })]),
  dating: thread("dating", [msg("6", 1000, { Subject: "Friday?", From: ME, To: "crush@example.invalid" })]),
};

describe("addressesIn", () => {
  it("pulls every address out of a header", () => {
    expect(addressesIn('"Doe, Jo" <Jo@Acme.example>, b@c.example')).toEqual(["jo@acme.example", "b@c.example"]);
    expect(addressesIn("")).toEqual([]);
  });
});

describe("collectEmails", () => {
  it("drops RSVPs, self-only threads and gated threads; keeps work with its sender and domains", async () => {
    const g = gate();
    const res = await collectEmails({
      mine,
      account: ME,
      gate: g,
      deps: {
        listThreads: vi.fn().mockResolvedValue(Object.keys(THREADS).map((id) => ({ id }))),
        getThreadMeta: vi.fn(async (id: string) => THREADS[id]),
      },
    });
    expect(res).toMatchObject({ threads: 5, rsvp: 2, selfOnly: 1 });
    expect(g.counts.contact).toBe(1);
    expect(res.items).toEqual([
      {
        ref: "gmail:work",
        kind: "email",
        title: "ERP cutover plan",
        at: new Date(2000).toISOString(),
        url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(ME)}#all/work`,
        detail: "Looks good & thanks",
        domains: ["vendor.example"],
        from: ME,
      },
    ]);
  });

  it("backs off on 429 and fails the collection after the retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const rate = Object.assign(new Error("429"), { status: 429 });
    const getThreadMeta = vi.fn().mockRejectedValueOnce(rate).mockResolvedValue(THREADS.work);
    const res = await collectEmails({
      mine,
      account: ME,
      gate: gate(),
      deps: { listThreads: vi.fn().mockResolvedValue([{ id: "work" }]), getThreadMeta, sleep },
    });
    expect(res.items).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(1000);

    const always = vi.fn().mockRejectedValue(rate);
    await expect(
      collectEmails({ mine, account: ME, gate: gate(), deps: { listThreads: always, sleep } }),
    ).rejects.toMatchObject({ status: 429 });
    expect(always).toHaveBeenCalledTimes(4);
  });
});

describe("Gmail helpers never ask for a body", () => {
  const urls: string[] = [];
  beforeEach(() => {
    urls.length = 0;
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "refresh");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
        if (String(url).includes("/threads?")) return new Response(JSON.stringify({ threads: [{ id: "work" }] }));
        return new Response(JSON.stringify(THREADS.work));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists sent threads and reads metadata only", async () => {
    await collectEmails({ mine, account: ME, gate: gate(), deps: { listThreads, getThreadMeta } });
    const gmail = urls.filter((u) => u.includes("gmail.googleapis.com"));
    expect(gmail).toHaveLength(2);
    expect(new URL(gmail[0]).searchParams.get("q")).toBe(GMAIL_QUERY);
    const get = new URL(gmail[1]);
    expect(get.pathname).toMatch(/\/threads\/work$/);
    expect(get.searchParams.get("format")).toBe("metadata");
    expect(get.searchParams.getAll("metadataHeaders")).toEqual(["Subject", "From", "To", "Cc"]);
    expect(get.searchParams.get("fields")).toBe("id,messages(id,internalDate,snippet,payload/headers)");
    for (const u of gmail) expect(u).not.toMatch(/format=(full|raw)|\/messages\//);
  });
});
