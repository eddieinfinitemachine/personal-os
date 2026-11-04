"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import type { CaptureProposal } from "@/lib/smart-capture";
import { BOARD_KINDS } from "@/lib/board-embed";
import type {
  CaptureReviewItem,
  ReviewCorrection,
} from "@/lib/capture-review/types";
import type { CaptureReviewChoices } from "./capture-review-inbox";

const inputClass =
  "min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm";
const actionClass =
  "min-h-11 rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--color-accent)] disabled:opacity-50";
const coreTypes = ["todo", "asset", "person", "trip", "interaction"] as const;
type CoreType = (typeof coreTypes)[number];
const typeLabels = {
  todo: "Task",
  asset: "Asset",
  person: "Person",
  trip: "Trip",
  interaction: "Interaction",
};

function emptyProposal(type: CoreType): CaptureProposal {
  switch (type) {
    case "todo":
      return { type, title: "", listName: "To Do" };
    case "asset":
      return { type, assetKind: "inventory", title: "" };
    case "person":
      return { type, firstName: "" };
    case "trip":
      return { type, name: "" };
    case "interaction":
      return {
        type,
        title: "",
        occurredAt: "",
        kind: "other",
        personHints: [],
      };
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="block text-xs font-medium text-[var(--color-muted-foreground)]">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Corrections use the journal endpoint, including when the destination changes. */
export function CaptureReviewEditor({
  review,
  lists = [],
  onSaved,
  onCancel,
}: CaptureReviewChoices & {
  review: CaptureReviewItem;
  onSaved: (review: CaptureReviewItem) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [proposal, setProposal] = useState<CaptureProposal | null>(
    review.proposal,
  );
  const [fields, setFields] = useState(review.fields);
  const [listId, setListId] = useState(
    typeof review.fields.listId === "string"
      ? review.fields.listId
      : (lists.find(
          (list) =>
            review.proposal?.type === "todo" &&
            list.name === review.proposal.listName,
        )?.id ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const drafts = useRef<Partial<Record<CoreType, CaptureProposal>>>({});
  const board = review.placement.type === "board",
    reader = review.placement.type === "reader";
  const values = (proposal ?? {}) as unknown as Record<string, unknown>;
  function patch(key: string, value: unknown) {
    setProposal((current) =>
      current ? ({ ...current, [key]: value } as CaptureProposal) : current,
    );
  }
  function setField(key: string, value: string | boolean | null) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  function switchType(type: CoreType) {
    if (
      !review.movable ||
      !proposal ||
      !coreTypes.includes(proposal.type as CoreType)
    )
      return;
    drafts.current[proposal.type as CoreType] = proposal;
    const next = emptyProposal(type);
    const title = proposal.type === "person" ? [proposal.firstName, proposal.lastName].filter(Boolean).join(" ") : proposal.type === "trip" ? proposal.name : "title" in proposal ? proposal.title : review.placement.title;
    if (next.type === "trip") next.name = title;
    else if (next.type !== "person" && "title" in next) next.title = title;
    setProposal(drafts.current[type] ?? next);
    setError(null);
  }
  function text(
    key: string,
    label: string,
    options: {
      type?: string;
      required?: boolean;
      multiline?: boolean;
      array?: boolean;
    } = {},
  ) {
    const value = options.array
      ? ((values[key] as string[] | undefined) ?? []).join(", ")
      : String(values[key] ?? "");
    const common = {
      name: key,
      value,
      required: options.required,
      className: inputClass,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) =>
        patch(
          key,
          options.array
            ? event.target.value
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean)
            : options.type === "number"
              ? event.target.value === ""
                ? null
                : Number(event.target.value)
              : event.target.value || null,
        ),
    };
    return (
      <Field key={key} label={label}>
        {options.multiline ? (
          <textarea {...common} rows={3} />
        ) : (
          <input
            {...common}
            type={options.type ?? "text"}
            value={options.type === "date" ? value.slice(0, 10) : value}
          />
        )}
      </Field>
    );
  }
  function select(key: string, label: string, options: readonly string[]) {
    const value = String(values[key] ?? "");
    return (
      <Field key={key} label={label}>
        <select
          name={key}
          value={value}
          onChange={(event) => patch(key, event.target.value || null)}
          className={inputClass}
        >
          <option value="">Choose…</option>
          {value && !options.includes(value) ? (
            <option value={value}>{value}</option>
          ) : null}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !review.correctable) return;
    setError(null);
    let next = proposal;
    if (!board && !reader) {
      if (!next) {
        setError("Open the saved item to edit this capture.");
        return;
      }
      const required =
        next.type === "person" || next.type === "call_sheet"
          ? next.firstName
          : next.type === "trip"
            ? next.name
            : next.title;
      if (!required?.trim()) {
        setError(
          next.type === "person" || next.type === "call_sheet"
            ? "Enter a first name before saving."
            : next.type === "trip"
              ? "Enter a trip name before saving."
              : "Enter a title before saving.",
        );
        return;
      }
      if (next.type === "interaction" && !next.occurredAt) {
        setError("Enter the interaction date before saving.");
        return;
      }
      if (next.type === "call_sheet" && !next.date) {
        setError("Enter a reminder date before saving.");
        return;
      }
      if (
        next.type === "trip" &&
        next.startDate &&
        next.endDate &&
        next.endDate < next.startDate
      ) {
        setError("The end date must be on or after the start date.");
        return;
      }
      if (
        next.type === "asset" &&
        next.followupTodo &&
        !next.followupTodo.title.trim()
      ) {
        setError("Enter a companion task title or remove the companion task.");
        return;
      }
    }
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }
    const body: ReviewCorrection = { revision: review.revision };
    if (board)
      body.fields = {
        title: fields.title ?? null,
        note: fields.note ?? null,
        kind: fields.kind ?? "link",
      };
    else if (reader)
      body.fields = {
        title: fields.title ?? "",
        byline: fields.byline ?? null,
        excerpt: fields.excerpt ?? null,
        read: !!fields.read,
        archived: !!fields.archived,
      };
    else if (next) {
      body.proposal = next;
      if (next.type === "todo")
        body.fields = {
          ...(listId ? { listId } : {}),
          ...(next.projectId !== undefined
            ? { projectId: next.projectId }
            : {}),
        };
    }
    busy.current = true;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/capture-reviews/${encodeURIComponent(review.id)}/correct`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.review)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Could not save this correction. Try again.",
        );
      onSaved(result.review as CaptureReviewItem);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this correction. Try again.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      onSubmit={save}
      aria-labelledby={titleId}
      className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] p-3 sm:p-4"
      noValidate
    >
      <h4 id={titleId} className="mb-3 text-sm font-semibold">
        Correct capture
      </h4>
      <fieldset disabled={saving} className="space-y-3">
        {review.movable &&
        proposal &&
        coreTypes.includes(proposal.type as CoreType) ? (
          <Field label="Save as">
            <select
              name="type"
              value={proposal.type}
              onChange={(event) => switchType(event.target.value as CoreType)}
              className={inputClass}
            >
              {coreTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Edit this saved item in place.
          </p>
        )}
        {board || reader ? (
          <>
            <Field label="Title">
              <input
                name="title"
                className={inputClass}
                value={String(fields.title ?? "")}
                required={reader}
                onChange={(event) =>
                  setField("title", event.target.value || null)
                }
              />
            </Field>
            {board ? (
              <>
                <Field label="Note">
                  <textarea
                    name="note"
                    className={inputClass}
                    rows={3}
                    value={String(fields.note ?? "")}
                    onChange={(event) =>
                      setField("note", event.target.value || null)
                    }
                  />
                </Field>
                <Field label="Board kind">
                  <select
                    name="kind"
                    className={inputClass}
                    value={String(fields.kind ?? "link")}
                    onChange={(event) => setField("kind", event.target.value)}
                  >
                    {BOARD_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Byline">
                  <input
                    name="byline"
                    className={inputClass}
                    value={String(fields.byline ?? "")}
                    onChange={(event) =>
                      setField("byline", event.target.value || null)
                    }
                  />
                </Field>
                <Field label="Excerpt">
                  <textarea
                    name="excerpt"
                    className={inputClass}
                    rows={3}
                    value={String(fields.excerpt ?? "")}
                    onChange={(event) =>
                      setField("excerpt", event.target.value || null)
                    }
                  />
                </Field>
                <div className="flex flex-wrap gap-x-5">
                  {["read", "archived"].map((key) => (
                    <label
                      key={key}
                      className="inline-flex min-h-11 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name={key}
                        checked={!!fields[key]}
                        onChange={(event) =>
                          setField(key, event.target.checked)
                        }
                      />
                      {key === "read" ? "Read" : "Archived"}
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        ) : proposal?.type === "todo" ? (
          <>
            {text("title", "Title", { required: true })}
            {text("notes", "Notes", { multiline: true })}
            {text("dueDate", "Due date", { type: "date" })}
            <Field label="List">
              <select
                name="listId"
                className={inputClass}
                value={listId}
                onChange={(event) => {
                  setListId(event.target.value);
                  const list = lists.find(
                    (item) => item.id === event.target.value,
                  );
                  if (list) patch("listName", list.name);
                }}
              >
                <option value="">{proposal.listName ?? "Choose a list"}</option>
                {listId && !lists.some((item) => item.id === listId) ? (
                  <option value={listId}>
                    {proposal.listName ?? "Current list"}
                  </option>
                ) : null}
                {lists.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : proposal?.type === "asset" ? (
          <>
            {select("assetKind", "Asset kind", [
              "inventory",
              "investment",
              "media",
              "place",
              "practice",
            ])}
            {text("title", "Title", { required: true })}
            {text("subtitle", "Subtitle")}
            {text("url", "URL", { type: "url" })}
            {text("category", "Category")}
            {text("status", "Status")}
            {text("notes", "Notes", { multiline: true })}
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-sm">
                More asset fields
              </summary>
              <div className="space-y-3">
                {text("costBasis", "Cost basis (USD)", { type: "number" })}
                {text("currentValue", "Current value (USD)", {
                  type: "number",
                })}
                {text("amountUsd", "Amount (USD)", { type: "number" })}
                {text("rating", "Rating", { type: "number" })}
                {text("location", "Location")}
                {text("acquiredAt", "Acquired on", { type: "date" })}
                {text("sourceVendor", "Source / vendor")}
                {Object.entries(proposal.details ?? {}).flatMap(
                  ([key, value]) => {
                    const array =
                      Array.isArray(value) &&
                      value.every((item) => typeof item === "string");
                    if (value !== null && typeof value === "object" && !array)
                      return [];
                    const label = key
                      .replace(/([a-z])([A-Z])/g, "$1 $2")
                      .replace(/[_-]/g, " ")
                      .replace(/^./, (letter) => letter.toUpperCase());
                    return [
                      <Field key={key} label={label}>
                        <input
                          name={`detail-${key}`}
                          className={
                            typeof value === "boolean" ? "size-5" : inputClass
                          }
                          type={
                            typeof value === "boolean"
                              ? "checkbox"
                              : typeof value === "number"
                                ? "number"
                                : "text"
                          }
                          {...(typeof value === "boolean"
                            ? { checked: value }
                            : {
                                value: array
                                  ? (value as string[]).join(", ")
                                  : String(value ?? ""),
                              })}
                          onChange={(event) =>
                            patch("details", {
                              ...proposal.details,
                              [key]:
                                typeof value === "boolean"
                                  ? event.target.checked
                                  : typeof value === "number"
                                    ? event.target.value === ""
                                      ? null
                                      : Number(event.target.value)
                                    : array
                                      ? event.target.value
                                          .split(",")
                                          .map((item) => item.trim())
                                          .filter(Boolean)
                                      : event.target.value || null,
                            })
                          }
                        />
                      </Field>,
                    ];
                  },
                )}
              </div>
            </details>
            {proposal.followupTodo ? (
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                <Field label="Companion task">
                  <input
                    name="followupTitle"
                    className={inputClass}
                    required
                    value={proposal.followupTodo.title}
                    onChange={(event) =>
                      patch("followupTodo", {
                        ...proposal.followupTodo,
                        title: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Companion task list">
                  <input
                    name="followupList"
                    className={inputClass}
                    value={proposal.followupTodo.listName ?? ""}
                    onChange={(event) =>
                      patch("followupTodo", {
                        ...proposal.followupTodo,
                        listName: event.target.value || null,
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  className={actionClass}
                  onClick={() => patch("followupTodo", null)}
                >
                  Remove companion task
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={actionClass}
                onClick={() => patch("followupTodo", { title: "" })}
              >
                Add companion task
              </button>
            )}
          </>
        ) : proposal?.type === "person" ? (
          <>
            {text("firstName", "First name", { required: true })}
            {text("lastName", "Last name")}
            {text("role", "Role")}
            {text("company", "Company")}
            {text("city", "City")}
            {text("country", "Country")}
            {text("email", "Email", { type: "email" })}
            {text("phone", "Phone", { type: "tel" })}
            {text("birthday", "Birthday", { type: "date" })}
            {select("strength", "Strength", [
              "close",
              "strong",
              "casual",
              "weak",
            ])}
            {text("howWeMet", "How we met")}
            {text("interests", "Interests (comma separated)", { array: true })}
            {text("circles", "Circles (comma separated)", { array: true })}
            {text("notes", "Notes", { multiline: true })}
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-sm">
                Social links
              </summary>
              <div className="space-y-3">
                {["linkedin", "twitter", "instagram", "github", "website"].map(
                  (key) => (
                    <Field key={key} label={key}>
                      <input
                        name={key}
                        type="url"
                        className={inputClass}
                        value={
                          proposal.socialUrls?.[
                            key as keyof NonNullable<typeof proposal.socialUrls>
                          ] ?? ""
                        }
                        onChange={(event) =>
                          patch("socialUrls", {
                            ...proposal.socialUrls,
                            [key]: event.target.value || null,
                          })
                        }
                      />
                    </Field>
                  ),
                )}
              </div>
            </details>
          </>
        ) : proposal?.type === "trip" ? (
          <>
            {text("name", "Name", { required: true })}
            {text("destination", "Destination")}
            {text("startDate", "Start date", { type: "date" })}
            {text("endDate", "End date", { type: "date" })}
            {select("status", "Status", [
              "planned",
              "booked",
              "active",
              "past",
              "cancelled",
            ])}
            {text("travelers", "Travelers (comma separated)", { array: true })}
            {text("transport", "Transport")}
            {text("accommodation", "Accommodation")}
            {text("costUsd", "Cost (USD)", { type: "number" })}
            {text("bookingUrl", "Booking URL", { type: "url" })}
            {text("notes", "Notes", { multiline: true })}
          </>
        ) : proposal?.type === "interaction" ? (
          <>
            {text("title", "Title", { required: true })}
            {text("occurredAt", "Date", { type: "date", required: true })}
            {select("kind", "Kind", [
              "dinner",
              "call",
              "meeting",
              "event",
              "message",
              "other",
            ])}
            {text("location", "Location")}
            {text("notes", "Notes", { multiline: true })}
            {proposal.personHints.map((person, index) => (
              <div key={index} className="grid grid-cols-2 gap-2">
                <Field label="Person first name">
                  <input
                    name={`personFirstName-${index}`}
                    className={inputClass}
                    value={person.firstName}
                    onChange={(event) =>
                      patch(
                        "personHints",
                        proposal.personHints.map((item, at) =>
                          at === index
                            ? { ...item, firstName: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Person last name">
                  <input
                    name={`personLastName-${index}`}
                    className={inputClass}
                    value={person.lastName ?? ""}
                    onChange={(event) =>
                      patch(
                        "personHints",
                        proposal.personHints.map((item, at) =>
                          at === index
                            ? { ...item, lastName: event.target.value || null }
                            : item,
                        ),
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  className={actionClass}
                  onClick={() =>
                    patch(
                      "personHints",
                      proposal.personHints.filter((_, at) => at !== index),
                    )
                  }
                >
                  Remove person
                </button>
              </div>
            ))}
            <button
              type="button"
              className={actionClass}
              onClick={() =>
                patch("personHints", [
                  ...proposal.personHints,
                  { firstName: "", lastName: null },
                ])
              }
            >
              Add person
            </button>
          </>
        ) : proposal?.type === "call_sheet" ? (
          <>
            {text("firstName", "First name", { required: true })}
            {text("lastName", "Last name")}
            {text("date", "Reminder date", { type: "date", required: true })}
            {text("note", "Note", { multiline: true })}
          </>
        ) : null}
      </fieldset>
      {error ? (
        <div role="alert" className="mt-3 text-sm">
          {error}
          {!review.placement.missing &&
          review.placement.path.startsWith("/") &&
          !review.placement.path.startsWith("//") ? (
            <a
              href={review.placement.path}
              className="ml-2 inline-flex min-h-11 items-center underline underline-offset-2"
            >
              Open saved item
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
        <button
          type="submit"
          disabled={
            saving || !review.correctable || (!proposal && !board && !reader)
          }
          className={
            actionClass +
            " bg-[var(--color-foreground)] text-[var(--color-background)] hover:opacity-80"
          }
        >
          {saving ? "Saving…" : "Save correction"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className={actionClass}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
