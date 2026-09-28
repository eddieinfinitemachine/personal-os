import { describe, expect, it, vi } from "vitest";
import {
  resolveAddedContacts,
  syncNewContactThreads,
} from "./dating-contact-sync";
import { findDatingContactChoices } from "../src/lib/dating-contact-match";
const contact = {
  name: "Avery Example",
  first: "Avery",
  last: "Example",
  phones: ["4155550101"],
  emails: [],
};
const ready = {
  status: "ready" as const,
  contacts: [contact],
  updatedAt: new Date().toISOString(),
  ageMs: 0,
};
describe("automatic lookup for saved dating profiles", () => {
  it("uses a current exact match, then returns the profile for matching message import", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ people: [{ id: "new", name: "Avery Example" }] })
      .mockResolvedValue({ resolved: true });
    expect(
      await resolveAddedContacts({ api, load: async () => ready }),
    ).toEqual(["new"]);
    expect(api.mock.calls[1][1]).toEqual({
      personId: "new",
      name: "Avery Example",
      handles: ["+14155550101"],
    });
  });
  it("sends choices rather than guessing a first name, and never uploads unrelated contacts", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ people: [{ id: "new", name: "Avery" }] })
      .mockResolvedValue({ ok: true });
    expect(
      await resolveAddedContacts({
        api,
        load: async () => ({
          ...ready,
          contacts: [
            contact,
            {
              ...contact,
              name: "Unrelated Person",
              first: "Unrelated",
              last: "Person",
            },
          ],
        }),
      }),
    ).toEqual([]);
    expect(api.mock.calls[1][1]).toMatchObject({
      status: "ambiguous",
      candidates: [{ name: "Avery Example", phones: ["+14155550101"] }],
    });
    expect(JSON.stringify(api.mock.calls)).not.toContain("Unrelated");
  });
  it("does not open Contacts when there are no missing profiles, and never uses a stale directory", async () => {
    const load = vi.fn().mockResolvedValue({ ...ready, status: "stale" });
    const api = vi.fn().mockResolvedValue({ people: [] });
    await resolveAddedContacts({ api, load });
    expect(load).not.toHaveBeenCalled();
    api.mockResolvedValueOnce({
      people: [{ id: "new", name: "Avery Example" }],
    });
    await resolveAddedContacts({ api, load });
    expect(api.mock.calls.at(-1)?.[1]).toMatchObject({ status: "unavailable" });
  });
  it("forces current Contacts for a new name and includes durable message retry requests", async () => {
    const load = vi.fn().mockResolvedValue(ready);
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        people: [{ id: "new", name: "Avery Example" }],
        refreshContacts: true,
        messageRetries: [{ id: "retry" }],
      })
      .mockResolvedValue({ resolved: true });
    expect(await resolveAddedContacts({ api, load })).toEqual(["retry", "new"]);
    expect(load).toHaveBeenCalledWith({ force: true });
  });
  it("keeps shared/rejected identities out of automatic message import", async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ people: [{ id: "new", name: "Avery Example" }] })
      .mockResolvedValue({ resolved: false, reason: "shared_contact" });
    expect(
      await resolveAddedContacts({ api, load: async () => ready }),
    ).toEqual([]);
  });
  it("bounds choices and never promotes partial names automatically", () => {
    expect(findDatingContactChoices("Avery", [contact])).toMatchObject({
      status: "ambiguous",
    });
    expect(
      findDatingContactChoices(
        "Avery",
        Array.from({ length: 6 }, (_, i) => ({
          ...contact,
          name: `Avery Example${i}`,
          last: `Example${i}`,
        })),
      ),
    ).toEqual({ status: "insufficient-name", candidates: [] });
  });
});
describe("new contact message import", () => {
  const old = { id: "old", name: "Old Person", handles: ["+14155550100"] };
  const added = { id: "new", name: "Avery Example", handles: ["+14155550101"] };
  it("bootstraps existing profiles but imports newly resolved people", async () => {
    const sync = vi.fn();
    const checked = vi.fn();
    const save = vi.fn();
    const checkpoint = await syncNewContactThreads({
      targets: [old, added],
      resolved: ["new"],
      checkpoint: null,
      sync,
      checked,
      save,
    });
    expect(sync.mock.calls).toEqual([["new"]]);
    expect(checked).toHaveBeenCalledWith(added);
    await syncNewContactThreads({
      targets: [old, added],
      resolved: [],
      checkpoint,
      sync,
      checked,
      save,
    });
    expect(sync).toHaveBeenCalledTimes(1);
    await syncNewContactThreads({
      targets: [old, { ...added, handles: ["+14155550102"] }],
      resolved: [],
      checkpoint,
      sync,
      checked,
      save,
    });
    expect(sync).toHaveBeenCalledTimes(2);
  });
  it("forces an explicit retry of unchanged handles and keeps it retryable after failure", async () => {
    const sync = vi.fn();
    const checked = vi.fn();
    const save = vi.fn();
    const initial = await syncNewContactThreads({
      targets: [old],
      resolved: [],
      checkpoint: null,
      sync,
      checked,
      save,
    });
    sync.mockRejectedValueOnce(Error("offline"));
    const failed = await syncNewContactThreads({
      targets: [old],
      resolved: ["old"],
      checkpoint: initial,
      sync,
      checked,
      save,
    });
    expect(failed.people.old).toBeUndefined();
    await syncNewContactThreads({
      targets: [old],
      resolved: [],
      checkpoint: failed,
      sync,
      checked,
      save,
    });
    expect(checked).toHaveBeenCalledWith(old);
  });
  it("retries failed import and detects a contact selected later in the web UI", async () => {
    const sync = vi
      .fn()
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValue(undefined);
    const checked = vi.fn();
    const save = vi.fn();
    const initial = await syncNewContactThreads({
      targets: [old],
      resolved: [],
      checkpoint: null,
      sync,
      checked,
      save,
    });
    const failed = await syncNewContactThreads({
      targets: [old, added],
      resolved: [],
      checkpoint: initial,
      sync,
      checked,
      save,
    });
    expect(failed.people.new).toBeUndefined();
    expect(checked).not.toHaveBeenCalled();
    await syncNewContactThreads({
      targets: [old, added],
      resolved: [],
      checkpoint: failed,
      sync,
      checked,
      save,
    });
    expect(checked).toHaveBeenCalledWith(added);
  });
});
