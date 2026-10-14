import { prisma } from "@/lib/prisma";

export type NameInput = { firstName: string; lastName?: string | null };
export type NamedPerson = {
  id: string;
  firstName: string;
  lastName: string | null;
};
export type PersonMatch =
  | { kind: "match"; person: NamedPerson }
  | { kind: "ambiguous"; candidates: NamedPerson[] }
  | { kind: "none" };

const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
export const displayName = (person: NameInput) =>
  [person.firstName, person.lastName ?? ""].join(" ").trim().replace(/\s+/g, " ");

/** Match a spoken name against people records. A full name matches
 * case-insensitively, including records that keep the whole name in firstName
 * ("Alex Morgan", lastName null). A lone first name matches only when exactly
 * one person has it; otherwise the caller must ask which one. */
export function matchPerson(
  people: NamedPerson[],
  input: NameInput,
): PersonMatch {
  const wanted = normalize(displayName(input));
  if (!wanted) return { kind: "none" };
  const firstNameOnly = !wanted.includes(" ");
  const matches = people.filter((person) => {
    if (!firstNameOnly) return normalize(displayName(person)) === wanted;
    const first = normalize(person.firstName);
    return (
      first === wanted ||
      (!person.lastName?.trim() && first.split(" ")[0] === wanted)
    );
  });
  if (matches.length === 1) return { kind: "match", person: matches[0] };
  if (matches.length > 1)
    return {
      kind: "ambiguous",
      candidates: [...matches].sort((a, b) =>
        displayName(a).localeCompare(displayName(b)),
      ),
    };
  return { kind: "none" };
}

export type ResolvedPerson =
  | { kind: "match" | "created"; person: NamedPerson }
  | { kind: "ambiguous"; candidates: NamedPerson[] };

/** Resolve a name among the user's non-archived people, creating a bare Person
 * (like the interaction capture path does for personHints) when nobody matches. */
export async function resolveOrCreatePerson(
  userId: string,
  input: NameInput,
): Promise<ResolvedPerson> {
  const firstName = input.firstName.trim().replace(/\s+/g, " ");
  const lastName = input.lastName?.trim().replace(/\s+/g, " ") || null;
  const firstToken = firstName.split(" ")[0];
  const people = await prisma.person.findMany({
    where: {
      userId,
      archived: false,
      firstName: { startsWith: firstToken, mode: "insensitive" },
    },
    select: { id: true, firstName: true, lastName: true },
  });
  const match = matchPerson(people, { firstName, lastName });
  if (match.kind === "match" || match.kind === "ambiguous") return match;
  const person = await prisma.person.create({
    data: { userId, firstName, lastName },
    select: { id: true, firstName: true, lastName: true },
  });
  return { kind: "created", person };
}
