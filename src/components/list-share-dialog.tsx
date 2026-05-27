"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Member = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
};

type Owner = { id: string; name: string | null; email: string };

export function ListShareDialog({
  listId,
  listName,
  onClose,
}: {
  listId: string;
  listName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/lists/${listId}/members`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setOwner(d.owner ?? null);
        setMembers(d.members ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [listId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Couldn't invite that user.");
        return;
      }
      const body = (await res.json()) as { member: Member };
      setMembers((prev) =>
        prev.some((m) => m.userId === body.member.userId)
          ? prev
          : [...prev, body.member],
      );
      setEmail("");
      window.dispatchEvent(
        new CustomEvent("personalos:list-membership-changed", {
          detail: { listId },
        }),
      );
      startTransition(() => router.refresh());
    } finally {
      setInviting(false);
    }
  }

  async function remove(memberUserId: string) {
    const before = members;
    setMembers((prev) => prev.filter((m) => m.userId !== memberUserId));
    const res = await fetch(
      `/api/lists/${listId}/members/${memberUserId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setMembers(before);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("personalos:list-membership-changed", {
        detail: { listId },
      }),
    );
    startTransition(() => router.refresh());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Share list
            </div>
            <div className="truncate font-semibold">{listName}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={invite}
          className="flex items-center gap-2 border-b border-[var(--color-border)] p-3"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            autoFocus
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!email.trim() || inviting}
            className="rounded-md bg-[var(--color-foreground)] px-3 py-1.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-50"
          >
            {inviting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" /> Inviting…
              </span>
            ) : (
              "Invite"
            )}
          </button>
        </form>
        {error ? (
          <div className="border-b border-[var(--color-border)] bg-rose-500/10 px-4 py-2 text-xs text-rose-500">
            {error}
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <ul className="space-y-2">
              {owner ? (
                <li className="flex items-center gap-3 rounded-md px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {owner.name ?? owner.email}{" "}
                      <span className="text-xs font-normal text-[var(--color-muted-foreground)]">
                        (owner)
                      </span>
                    </div>
                    {owner.name ? (
                      <div className="truncate text-xs text-[var(--color-muted-foreground)]">
                        {owner.email}
                      </div>
                    ) : null}
                  </div>
                </li>
              ) : null}
              {members.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-[var(--color-muted-foreground)]">
                  No collaborators yet. Invite someone above.
                </li>
              ) : (
                members.map((m) => (
                  <li
                    key={m.userId}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-accent)]/40",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {m.name ?? m.email}
                      </div>
                      {m.name ? (
                        <div className="truncate text-xs text-[var(--color-muted-foreground)]">
                          {m.email}
                        </div>
                      ) : null}
                    </div>
                    <button
                      onClick={() => remove(m.userId)}
                      className="rounded-md p-1.5 text-rose-500 hover:bg-rose-500/10"
                      aria-label={`Remove ${m.email}`}
                      title="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
