"use client";

import { useCallback, useRef, useState } from "react";
import { parseHandles } from "@/lib/dating";
import type { DatingPersonDTO } from "@/lib/dating-server";

export type PersonPatch = Partial<Record<keyof DatingPersonDTO, unknown>>;

/** Serialize saves; render confirmed values with the remaining pending edits overlaid. */
export function useDatingPerson(initial: DatingPersonDTO, setError: (error: string | null) => void) {
  const [person, setVisible] = useState(initial);
  const confirmed = useRef(initial);
  const pending = useRef<Partial<DatingPersonDTO>[]>([]);
  const tail = useRef(Promise.resolve());
  const publish = useCallback(() => {
    setVisible(Object.assign({}, confirmed.current, ...pending.current));
  }, []);
  const setPerson = useCallback((value: Partial<DatingPersonDTO>) => {
    confirmed.current = { ...confirmed.current, ...value };
    publish();
  }, [publish]);

  const patch = useCallback((fields: PersonPatch): Promise<void> => {
    const optimistic = { ...fields } as Partial<DatingPersonDTO>;
    if ("handles" in fields) optimistic.handles = parseHandles(fields.handles);
    pending.current.push(optimistic);
    publish();
    setError(null);
    const save = tail.current.then(async () => {
      try {
        const res = await fetch(`/api/dating/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.person) throw new Error(data.error ?? "Could not save");
        // The server returns the whole profile. Apply only this operation's
        // fields so a delayed response cannot undo an independent refresh.
        const keys = Object.keys(fields);
        if (fields.stage === "ended" && !("endedAt" in fields)) keys.push("endedAt");
        confirmed.current = { ...confirmed.current, ...Object.fromEntries(keys.map((key) => [key, data.person[key]])) };
      } catch (error) {
        setError(error instanceof Error && error.message !== "Failed to fetch"
          ? `Could not save: ${error.message}. Try again.`
          : "Could not save. Try again.");
      } finally {
        pending.current = pending.current.filter((item) => item !== optimistic);
        publish();
      }
    });
    tail.current = save;
    return save;
  }, [initial.id, publish, setError]);

  return { person, setPerson, patch };
}
