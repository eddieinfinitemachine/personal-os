// Who each EC/* delegation list belongs to. The alias table in src/lib/alias.ts
// already maps "EC/Dave" → "dave"; this roster adds the spellings a transcript
// uses, the role the extraction prompt shows the model, and the people who
// work under each member: a commitment owned by someone on Dave's team is
// followed up through Dave, so it files to Dave's list. Lists not listed here
// (EC/Ben, EC/JC, EC/HG…) still resolve through the alias table.
export type TeamMember = {
  listName: string;
  /** First entry is the everyday name; include transcript misspellings. */
  names: string[];
  role: string;
  /** People who report to this member; their items file to this list. */
  reports?: string[];
};

export const TEAM: TeamMember[] = [
  {
    listName: "EC/Dave",
    names: ["Dave", "David", "David Vollbach"],
    role: "sales (showroom, test rides, deposits, dealers)",
    reports: ["Ash", "Analia", "Amalia", "Marta"],
  },
  {
    listName: "EC/Obie",
    names: ["Obie", "Obi", "Obie Odom"],
    role: "digital (CRM, call sheet, automations, ads, reports)",
  },
  {
    listName: "EC/Nolan",
    names: ["Nolan", "Nolan Fawthorp"],
    role: "events and community",
  },
  {
    listName: "EC/JC",
    names: ["Joe", "Joseph", "Joseph Cohen", "Joe Cohen", "JC"],
    role: "CEO, Infinite Machine",
  },
  {
    listName: "EC/HG",
    names: ["Hudson", "Hudson Groner", "HG"],
    role: "CEO, Walden",
  },
  {
    listName: "EC/Ben",
    names: ["Ben", "Ben Rubin", "Benjamin"],
    role: "Here Not There (C2)",
  },
];
