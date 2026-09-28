"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ContactLookupResult = {
  lookup: {
    status:
      | "pending"
      | "matched"
      | "ambiguous"
      | "not_found"
      | "unavailable"
      | "insufficient_name";
    name: string;
    checkedAt: string | null;
    messagesCheckedAt?: string | null;
    messagesError?: boolean;
    candidates: {
      name: string;
      phones: string[];
      emails: string[];
      instagram?: string | null;
    }[];
  };
  messageCount: number;
  lastMessageAt: string | null;
};
const button =
  "inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--color-accent)] disabled:opacity-50";
const waiting = (data: ContactLookupResult) =>
  data.lookup.status === "pending" ||
  (data.lookup.status === "matched" &&
    !data.messageCount &&
    !data.lookup.messagesCheckedAt &&
    !data.lookup.messagesError);

/** Read automatic work on the Mac; only ambiguous identities need a decision. */
export function ContactLookup({
  personId,
  name,
}: {
  personId: string;
  name: string;
}) {
  const router = useRouter();
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;
  const [result, setResult] = useState<{
    personId: string;
    data: ContactLookupResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const identity = useRef(personId);
  identity.current = personId;
  const data = result?.personId === personId ? result.data : null;

  useEffect(() => {
    setError(null);
    setResult(null);
    setBusy(false);
    inFlight.current = false;
  }, [personId, name]);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: string | null = null;
    const started = Date.now();
    setSlow(false);
    const poll = async () => {
      if (
        stopped ||
        polling ||
        inFlight.current ||
        document.visibilityState !== "visible"
      )
        return;
      polling = true;
      const ownRequest = ++request.current;
      const abort = new AbortController();
      controller.current = abort;
      const timeout = setTimeout(() => abort.abort(), 12_000);
      let again = false;
      try {
        const res = await fetch(`/api/dating/${personId}/contact-lookup`, {
          cache: "no-store",
          signal: abort.signal,
        });
        const next = (await res.json()) as ContactLookupResult & {
          error?: string;
        };
        if (
          stopped ||
          ownRequest !== request.current ||
          abort.signal.aborted ||
          document.visibilityState !== "visible"
        )
          return;
        if (!res.ok || !next.lookup)
          throw new Error("Could not check saved contacts. Try again.");
        setResult({ personId, data: next });
        setError(null);
        const marker = JSON.stringify([
          next.lookup.status,
          next.lookup.checkedAt,
          next.messageCount,
          next.lastMessageAt,
        ]);
        if (
          marker !== previous &&
          (next.lookup.status === "matched" ||
            (previous !== null && next.messageCount > 0))
        )
          refresh.current();
        previous = marker;
        again = waiting(next);
      } catch {
        if (
          !stopped &&
          ownRequest === request.current &&
          document.visibilityState === "visible"
        ) {
          setError("Could not check saved contacts. Try again.");
        }
      } finally {
        clearTimeout(timeout);
        polling = false;
        if (
          !stopped &&
          again &&
          ownRequest === request.current &&
          document.visibilityState === "visible"
        ) {
          const delayed = Date.now() - started >= 120_000;
          setSlow(delayed);
          timer = setTimeout(poll, delayed ? 30_000 : 5_000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") {
        if (polling) timer = setTimeout(poll, 5_000);
        else void poll();
      } else controller.current?.abort();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [personId, name, revision]);

  const act = async (action: "retry" | "choose", index?: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const ownRequest = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dating/${personId}/contact-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify(
          action === "choose"
            ? { action, index, checkedAt: data?.lookup.checkedAt }
            : { action },
        ),
      });
      const next = await res.json().catch(() => ({}));
      if (
        identity.current !== personId ||
        request.current !== ownRequest ||
        abort.signal.aborted
      )
        return;
      if (!res.ok)
        throw new Error(
          next.error || "Could not update saved contacts. Try again.",
        );
      setRevision((value) => value + 1);
    } catch (cause) {
      if (identity.current === personId && request.current === ownRequest) {
        setError(
          cause instanceof Error &&
            cause.name !== "AbortError" &&
            cause.message !== "Failed to fetch"
            ? cause.message
            : "Could not update saved contacts. Try again.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (identity.current === personId && request.current === ownRequest) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  if (data?.lookup.status === "matched" && data.messageCount > 0 && !error)
    return null;
  if (!data && !error) return null;
  const status = data?.lookup.status;
  return (
    <section
      aria-label="Saved contact lookup"
      className="mt-4 rounded-lg bg-[var(--color-fill-secondary)] px-3 py-2 text-sm"
    >
      <div role="status" className="text-[var(--color-muted-foreground)]">
        {status === "pending" && !error && (
          <>
            <p>
              {slow
                ? "Waiting for your Mac to check Contacts."
                : "Finding her in Contacts…"}
            </p>
            <p className="mt-1 text-xs">
              This usually starts within a minute while your Mac is awake.
            </p>
          </>
        )}
        {status === "matched" && !error && (
          <p>
            {data?.lookup.messagesError
              ? "Contact found. Your Mac could not check messages. Check iMessage access on your Mac; it will try again automatically."
              : data?.lookup.messagesCheckedAt
                ? "Contact found. No matching messages found yet."
                : slow
                  ? "Contact found. Waiting for your Mac to check matching messages."
                  : "Contact found. Checking matching messages on your Mac."}
          </p>
        )}
        {status === "ambiguous" && (
          <p>
            More than one saved contact could be her. Choose the right person.
          </p>
        )}
        {status === "not_found" && (
          <p>
            No matching contact found. Try the full name saved in Contacts, then
            check again.
          </p>
        )}
        {status === "insufficient_name" && (
          <p>
            Add her full name above so I can find the right person in Contacts.
          </p>
        )}
        {status === "unavailable" && (
          <p>
            Your Mac’s contact access needs attention. Allow Contacts access on
            your Mac, then try again.
          </p>
        )}
      </div>
      {status === "ambiguous" && (
        <ul className="mt-2 divide-y divide-[var(--color-card-border)]">
          {data?.lookup.candidates.map((candidate, index) => (
            <li
              key={`${candidate.name}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0 break-words">
                <p className="font-medium">{candidate.name}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {[...candidate.phones, ...candidate.emails].join(" · ")}
                </p>
              </div>
              <button
                disabled={busy}
                className={button}
                onClick={() => void act("choose", index)}
                aria-label={`Use contact ${candidate.name}, ${[...candidate.phones, ...candidate.emails].join(", ")}`}
              >
                Use this contact
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      {(error ||
        status === "not_found" ||
        status === "insufficient_name" ||
        status === "unavailable" ||
        (status === "matched" &&
          (data?.lookup.messagesCheckedAt || data?.lookup.messagesError))) && (
        <button
          disabled={busy}
          className={`${button} -ml-3`}
          onClick={() => void act("retry")}
        >
          {busy ? "Checking…" : "Check again"}
        </button>
      )}
    </section>
  );
}
