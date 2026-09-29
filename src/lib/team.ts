// Eddie's delegation lists are named by initials, not first names, so the
// EC/* alias table alone can't map "Dave" → "EC/DV". This table says who each
// initials list belongs to; meeting import uses it in the extraction prompt
// and in the owner → list resolver. Other EC/* lists (EC/Ash, EC/Ben…) still
// resolve through the alias table in src/lib/alias.ts.
export type TeamMember = {
  listName: string;
  /** First entry is the everyday name; include transcript misspellings. */
  names: string[];
  role: string;
};

export const TEAM: TeamMember[] = [
  { listName: "EC/DV", names: ["Dave", "David", "David Vollbach"], role: "sales" },
  { listName: "EC/OB", names: ["Obie", "Obi", "Obie Odom"], role: "digital" },
];
