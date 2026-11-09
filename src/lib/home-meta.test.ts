import { describe, expect, it } from "vitest";
import { commentStatsByTodo, creatorName, listSharing, todoMeta } from "./home-meta";

const at = (iso: string) => new Date(`2026-11-0${iso}Z`);
const comment = (todoId: string, authorId: string, when: string) => ({
  todoId,
  authorId,
  createdAt: at(when),
});

describe("commentStatsByTodo", () => {
  it("counts every comment per todo", () => {
    const stats = commentStatsByTodo(
      [comment("a", "me", "1T10:00:00"), comment("a", "shane", "1T11:00:00"), comment("b", "shane", "1T12:00:00")],
      [],
      "me",
    );
    expect(stats.get("a")?.count).toBe(2);
    expect(stats.get("b")?.count).toBe(1);
    expect(stats.has("c")).toBe(false);
  });

  it("counts others' comments after this user's lastReadAt as unread", () => {
    const stats = commentStatsByTodo(
      [
        comment("a", "shane", "1T09:00:00"), // before the read
        comment("a", "shane", "1T10:00:00"), // exactly at the read
        comment("a", "shane", "1T11:00:00"), // after the read
        comment("a", "maya", "1T12:00:00"), // after the read
        comment("b", "shane", "1T09:00:00"), // b was never read
      ],
      [{ todoId: "a", lastReadAt: at("1T10:00:00") }],
      "me",
    );
    expect(stats.get("a")).toEqual({ count: 4, unread: 2 });
    expect(stats.get("b")).toEqual({ count: 1, unread: 1 });
  });

  it("never counts the user's own comments as unread", () => {
    const stats = commentStatsByTodo(
      [comment("a", "me", "1T11:00:00"), comment("a", "me", "1T12:00:00")],
      [{ todoId: "a", lastReadAt: at("1T10:00:00") }],
      "me",
    );
    expect(stats.get("a")).toEqual({ count: 2, unread: 0 });
    // Never read either: still not unread.
    expect(commentStatsByTodo([comment("b", "me", "1T11:00:00")], [], "me").get("b")).toEqual({
      count: 1,
      unread: 0,
    });
  });

  it("only applies a read marker to its own todo", () => {
    const stats = commentStatsByTodo(
      [comment("a", "shane", "1T09:00:00")],
      [{ todoId: "b", lastReadAt: at("1T10:00:00") }],
      "me",
    );
    expect(stats.get("a")).toEqual({ count: 1, unread: 1 });
  });
});

describe("todoMeta", () => {
  const user = { name: "Shane", email: "shane@example.invalid" };

  it("reads the creator, attachments and comment stats", () => {
    const stats = new Map([["t1", { count: 3, unread: 1 }]]);
    expect(todoMeta({ id: "t1", user, _count: { attachments: 2 } }, stats)).toEqual({
      creatorName: "Shane",
      attachmentCount: 2,
      commentCount: 3,
      unreadCommentCount: 1,
    });
  });

  it("defaults to zero comments when the todo has none", () => {
    expect(todoMeta({ id: "t2", user, _count: { attachments: 0 } }, new Map())).toEqual({
      creatorName: "Shane",
      attachmentCount: 0,
      commentCount: 0,
      unreadCommentCount: 0,
    });
  });
});

describe("creatorName", () => {
  it("prefers the name, falls back to the email, and is null without a user", () => {
    expect(creatorName({ user: { name: "Shane", email: "s@example.invalid" } })).toBe("Shane");
    expect(creatorName({ user: { name: null, email: "s@example.invalid" } })).toBe("s@example.invalid");
    expect(creatorName({ user: null })).toBeNull();
  });
});

describe("listSharing", () => {
  const owner = { name: null, email: "eddie@example.invalid" };
  const members = [
    { user: { name: "Shane", email: "shane@example.invalid" } },
    { user: { name: null, email: "maya@example.invalid" } },
  ];

  it("owner's view of a list with members: collaborative, with the members' names", () => {
    expect(listSharing({ userId: "me", user: owner, members, _count: { members: 2 } }, "me")).toEqual({
      shared: false,
      ownerName: null,
      collaborative: true,
      sharedWithNames: ["Shane", "maya@example.invalid"],
    });
  });

  it("owner's view of a private list: not collaborative", () => {
    expect(listSharing({ userId: "me", user: owner, members: [], _count: { members: 0 } }, "me")).toEqual({
      shared: false,
      ownerName: null,
      collaborative: false,
      sharedWithNames: [],
    });
  });

  it("member's view: shared, the owner's name, and no member names", () => {
    expect(
      listSharing({ userId: "eddie", user: owner, members, _count: { members: 2 } }, "shane"),
    ).toEqual({
      shared: true,
      ownerName: "eddie@example.invalid",
      collaborative: true,
      sharedWithNames: [],
    });
  });
});
