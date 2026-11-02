"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CaptureReviewEditor } from "./capture-review-editor";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import type {
  CaptureReviewItem,
  CaptureReviewList,
  ReviewPlacement,
  ReviewState,
} from "@/lib/capture-review/types";

export type CaptureReviewChoices = {
  projects?: { id: string; name: string }[];
  lists?: { id: string; name: string }[];
};
const actionClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--color-accent)] disabled:opacity-50";
// Home's one-line rows: quiet text actions, full touch height only on phones.
const compactActionClass =
  "inline-flex min-h-11 md:min-h-0 items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50";
// Home shows only the newest few; the rest are a click away on /captures.
const COMPACT_ROWS = 3;
const safePath = (value: string) =>
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !/[\\\x00-\x1f]/.test(value);
const fingerprint = (data: CaptureReviewList | null) => JSON.stringify(data);
function fileSize(size: number | null) {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function Placement({ placement }: { placement: ReviewPlacement }) {
  return (
    <>
      <p className="text-sm">
        {placement.missing
          ? "Saved item removed"
          : `Placed in ${placement.destination}`}
      </p>
      {placement.related?.length ? (
        <ul
          className="mt-1 space-y-1 text-xs text-[var(--color-muted-foreground)]"
          aria-label="Related saved items"
        >
          {placement.related.map((item) => (
            <li key={`${item.type}:${item.id}`}>
              {!item.missing && safePath(item.path) ? (
                <Link
                  href={item.path}
                  className="inline-flex min-h-11 items-center underline decoration-[var(--color-border)] underline-offset-2"
                >
                  {item.title} · {item.destination}
                </Link>
              ) : (
                <span>
                  {item.title} · {item.missing ? "Removed" : item.destination}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function CaptureReviewInbox({
  initialData,
  initialError = null,
  fullPage = false,
  compact = false,
  initialState = "pending",
  projects = [],
  lists = [],
}: CaptureReviewChoices & {
  initialData: CaptureReviewList | null;
  initialError?: string | null;
  fullPage?: boolean;
  /** Home: one line per capture, newest few only, no empty-state box. */
  compact?: boolean;
  initialState?: ReviewState;
}) {
  const router = useRouter();
  const headingId = useId();
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [editing, setEditing] = useState<CaptureReviewItem | null>(null);
  const [undo, setUndo] = useState<{
    review: CaptureReviewItem;
    action: "dismiss" | "restore";
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dataRef = useRef(initialData);
  const fingerprintRef = useRef(fingerprint(initialData));
  const query = useRef({
    state: initialState,
    offset: initialData?.offset ?? 0,
    limit: 10,
  });
  const request = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  });
  const mutationRef = useRef(false);
  const alive = useRef(true);

  // A server refresh supplies a new snapshot; accepting it never triggers another refresh.
  useEffect(() => {
    query.current = {
      state: initialState,
      offset: initialData?.offset ?? 0,
      limit: 10,
    };
    dataRef.current = initialData;
    fingerprintRef.current = fingerprint(initialData);
    setData(initialData);
    setError(initialError);
  }, [initialData, initialError, initialState]);

  const update = useCallback(
    (next: CaptureReviewList, refreshHome: boolean) => {
      const nextFingerprint = fingerprint(next);
      const changed = nextFingerprint !== fingerprintRef.current;
      dataRef.current = next;
      fingerprintRef.current = nextFingerprint;
      setData(next);
      if (changed && refreshHome && !fullPage) router.refresh();
    },
    [fullPage, router],
  );

  const load = useCallback(
    async (offset = query.current.offset) => {
      if (document.visibilityState === "hidden" || mutationRef.current) return;
      request.current.controller?.abort();
      const controller = new AbortController(),
        id = ++request.current.id;
      request.current.controller = controller;
      query.current.offset = offset;
      setLoading(true);
      try {
        const { state, limit } = query.current;
        const response = await fetch(
          `/api/capture-reviews?state=${state}&offset=${offset}&limit=${limit}`,
          { method: "GET", cache: "no-store", signal: controller.signal },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(result.items))
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Could not load captures. Try again.",
          );
        if (
          !alive.current ||
          controller.signal.aborted ||
          id !== request.current.id
        )
          return;
        const next = result as CaptureReviewList;
        if (offset > 0 && !next.items.length && next.total <= offset) {
          query.current.offset = Math.max(
            0,
            Math.ceil(next.total / limit) * limit - limit,
          );
          void load(query.current.offset);
          return;
        }
        setError(null);
        update(next, true);
      } catch (cause) {
        if (
          alive.current &&
          !controller.signal.aborted &&
          id === request.current.id
        )
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load captures. Try again.",
          );
      } finally {
        if (alive.current && id === request.current.id) setLoading(false);
      }
    },
    [update],
  );

  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        request.current.controller?.abort();
        setLoading(false);
      } else refresh();
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("personalos:capture-saved", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      request.current.controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("personalos:capture-saved", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load]);

  function applyReview(review: CaptureReviewItem) {
    request.current.controller?.abort();
    ++request.current.id;
    const current = dataRef.current;
    if (!current) {
      void load();
      return;
    }
    const included =
      query.current.state === "dismissed"
        ? !!review.dismissedAt
        : !review.dismissedAt;
    const existed = current.items.some((item) => item.id === review.id);
    const items = included
      ? existed
        ? current.items.map((item) => (item.id === review.id ? review : item))
        : [review, ...current.items].slice(0, 10)
      : current.items.filter((item) => item.id !== review.id);
    const total = Math.max(
      0,
      current.total +
        (included && !existed ? 1 : !included && existed ? -1 : 0),
    );
    update(
      {
        ...current,
        items,
        total,
        hasMore: current.offset + items.length < total,
      },
      true,
    );
    setLoading(false);
  }
  async function changeState(
    review: CaptureReviewItem,
    action: "dismiss" | "restore",
    isUndo = false,
  ) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    request.current.controller?.abort();
    ++request.current.id;
    setMutating(review.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/capture-reviews/${encodeURIComponent(review.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: review.revision, action }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.review)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Could not update this review. Try again.",
        );
      if (!alive.current) return;
      const changed = result.review as CaptureReviewItem;
      applyReview(changed);
      setUndo(
        isUndo
          ? null
          : {
              review: changed,
              action: action === "dismiss" ? "restore" : "dismiss",
            },
      );
      setNotice(
        `${action === "dismiss" ? "Dismissed" : "Restored"} ${changed.placement.title}.`,
      );
      mutationRef.current = false;
      await load();
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not update this review. Try again.",
        );
    } finally {
      mutationRef.current = false;
      if (alive.current) setMutating(null);
    }
  }
  function corrected(review: CaptureReviewItem) {
    applyReview(review);
    setEditing(null);
    setError(null);
    setNotice(`Corrected ${review.placement.title}.`);
    void load();
  }
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading}
      className={cn("min-w-0", compact ? "mb-5" : "mb-7")}
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2
            id={headingId}
            className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]"
          >
            Capture Inbox
          </h2>
          {data ? (
            <span className="text-xs tabular-nums text-[var(--color-muted-foreground)]">
              {compact && data.total === 0
                ? "All caught up"
                : `${data.total} ${initialState}`}
            </span>
          ) : null}
        </div>
        {fullPage ? (
          <nav
            aria-label="Capture review state"
            className="flex flex-wrap gap-1"
          >
            <Link
              href="/captures"
              aria-current={initialState === "pending" ? "page" : undefined}
              className={actionClass}
            >
              Pending
            </Link>
            <Link
              href="/captures?state=dismissed"
              aria-current={initialState === "dismissed" ? "page" : undefined}
              className={actionClass}
            >
              Dismissed
            </Link>
          </nav>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Link
              href="/captures?state=dismissed"
              className={compact ? compactActionClass : actionClass}
            >
              Dismissed
            </Link>
            <Link
              href="/captures"
              className={compact ? compactActionClass : actionClass}
            >
              Show all
            </Link>
          </div>
        )}
      </header>
      {error ? (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center gap-x-2 rounded-lg bg-[var(--color-muted)] px-3 text-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            className={actionClass}
            disabled={loading || !!mutating}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="mb-2 flex flex-wrap items-center gap-x-2 rounded-lg bg-[var(--color-muted)] px-3 text-sm"
        >
          <span>{notice}</span>
          {undo ? (
            <button
              type="button"
              disabled={!!mutating}
              className={actionClass}
              onClick={() => void changeState(undo.review, undo.action, true)}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      {!data && !error ? (
        <p
          role="status"
          className="py-3 text-sm text-[var(--color-muted-foreground)]"
        >
          Loading captures…
        </p>
      ) : null}
      {data && data.items.length === 0 && !error && !compact ? (
        <p className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          {initialState === "pending"
            ? "All caught up. New captures will appear here after they save."
            : "No dismissed captures."}
        </p>
      ) : null}
      {data?.items.length ? (
        <ol className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
          {data.items
            .slice(0, compact ? COMPACT_ROWS : undefined)
            .map((review) => {
              const btn = compact ? compactActionClass : actionClass;
              const actions = (
                <>
                  {!review.placement.missing &&
                  safePath(review.placement.path) ? (
                    <Link href={review.placement.path} className={btn}>
                      Open
                    </Link>
                  ) : null}
                  {review.correctable && !review.placement.missing ? (
                    <button
                      type="button"
                      disabled={!!mutating}
                      aria-expanded={editing?.id === review.id}
                      className={btn}
                      onClick={() =>
                        setEditing((current) =>
                          current?.id === review.id ? null : review,
                        )
                      }
                    >
                      Correct
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!!mutating || editing?.id === review.id}
                    className={btn}
                    onClick={() =>
                      void changeState(
                        review,
                        review.dismissedAt ? "restore" : "dismiss",
                      )
                    }
                  >
                    {mutating === review.id
                      ? "Saving…"
                      : review.dismissedAt
                        ? "Restore"
                        : "Dismiss"}
                  </button>
                </>
              );
              const editor =
                editing?.id === review.id ? (
                  <CaptureReviewEditor
                    key={`${editing.id}:${editing.revision}`}
                    review={editing}
                    projects={projects}
                    lists={lists}
                    onSaved={corrected}
                    onCancel={() => setEditing(null)}
                  />
                ) : null;
              if (compact)
                return (
                  <li
                    key={review.id}
                    className="min-w-0 py-1 pl-3 pr-1 sm:pl-4"
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium">
                          {review.placement.title}
                        </span>
                        <span className="text-[var(--color-muted-foreground)]">
                          {" · "}
                          {review.placement.missing
                            ? "Removed"
                            : review.placement.destination}
                        </span>
                      </p>
                      <time
                        dateTime={review.createdAt}
                        title={`from ${review.sourceLabel}`}
                        suppressHydrationWarning
                        className="hidden shrink-0 text-xs tabular-nums text-[var(--color-muted-foreground)] sm:inline"
                      >
                        {timeAgo(review.createdAt)}
                      </time>
                      <div className="flex shrink-0">{actions}</div>
                    </div>
                    {editor}
                  </li>
                );
              return (
                <li key={review.id} className="min-w-0 px-3 py-3 sm:px-4">
                  <div className="flex flex-col gap-x-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-medium">
                        {review.placement.title}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                        from {review.sourceLabel} ·{" "}
                        <time dateTime={review.createdAt}>
                          {new Date(review.createdAt).toLocaleString("en-US", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "UTC",
                          })}{" "}
                          UTC
                        </time>
                        {review.correctedAt ? " · Corrected" : ""}
                      </p>
                      {review.input.text ? (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm text-[var(--color-muted-foreground)]">
                          {review.input.text}
                        </p>
                      ) : null}
                      {review.input.url ? (
                        <p
                          className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]"
                          title={review.input.url}
                        >
                          {review.input.url}
                        </p>
                      ) : null}
                      {review.input.files.length ? (
                        <ul
                          aria-label="Captured files"
                          className="mt-1 space-y-0.5 text-xs text-[var(--color-muted-foreground)]"
                        >
                          {review.input.files.map((file, index) => (
                            <li
                              key={`${file.name}:${index}`}
                              className="break-words"
                            >
                              {file.name}
                              {file.size !== null
                                ? ` · ${fileSize(file.size)}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2">
                        <Placement placement={review.placement} />
                      </div>
                    </div>
                    <div className="-ml-3 mt-1 flex shrink-0 flex-wrap gap-0 sm:ml-0 sm:mt-0">
                      {actions}
                    </div>
                  </div>
                  {editor}
                </li>
              );
            })}
        </ol>
      ) : null}
      {fullPage && data && (data.offset > 0 || data.hasMore) ? (
        <nav
          aria-label="Capture review pages"
          className="mt-3 flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {data.offset + 1}–{data.offset + data.items.length} of {data.total}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className={actionClass}
              disabled={loading || !!mutating || data.offset === 0}
              onClick={() => {
                setEditing(null);
                void load(Math.max(0, data.offset - data.limit));
              }}
            >
              Previous
            </button>
            <button
              type="button"
              className={actionClass}
              disabled={loading || !!mutating || !data.hasMore}
              onClick={() => {
                setEditing(null);
                void load(data.offset + data.limit);
              }}
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
