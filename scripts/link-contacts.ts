#!/usr/bin/env node
/**
 * link-contacts.ts
 * Purpose: Export macOS Contacts, match to Person DB records via multi-tier matching,
 *          update Person.phone/email (if null), and write contact handles + report.
 * Privacy: On-device Contacts API, outputs only handles/metadata (no content).
 * Usage: pnpm dlx tsx scripts/link-contacts.ts [--dry-run] [--refresh]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// Minimal .env loader
try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const prisma = new PrismaClient();
const dataDir = join(homedir(), "Library/Application Support/personal-os");
const contactsPath = join(dataDir, "contacts.json");
const dryRun = process.argv.includes("--dry-run");
const refresh = process.argv.includes("--refresh");

// Nickname mappings (bidirectional)
const NICK: Record<string, string[]> = {
  mike: ["michael"],
  michael: ["mike"],
  dave: ["david"],
  david: ["dave"],
  jeff: ["jeffrey"],
  jeffrey: ["jeff"],
  alex: ["alexander", "alexandra"],
  alexander: ["alex"],
  alexandra: ["alex"],
  ben: ["benjamin"],
  benjamin: ["ben"],
  chris: ["christopher", "christian"],
  christopher: ["chris"],
  christian: ["chris"],
  dan: ["daniel"],
  danny: ["daniel"],
  daniel: ["dan", "danny"],
  jon: ["jonathan"],
  jonathan: ["jon"],
  matt: ["matthew"],
  matthew: ["matt"],
  nick: ["nicholas"],
  nicholas: ["nick"],
  rob: ["robert"],
  bob: ["robert"],
  robert: ["rob", "bob"],
  sam: ["samuel", "samantha"],
  samuel: ["sam"],
  samantha: ["sam"],
  tom: ["thomas"],
  thomas: ["tom"],
  will: ["william"],
  bill: ["william"],
  william: ["will", "bill"],
  josh: ["joshua"],
  joshua: ["josh"],
  andy: ["andrew"],
  andrew: ["andy"],
  steve: ["steven", "stephen"],
  steven: ["steve"],
  stephen: ["steve"],
  jim: ["james"],
  jimmy: ["james"],
  james: ["jim", "jimmy"],
  liz: ["elizabeth"],
  beth: ["elizabeth"],
  elizabeth: ["liz", "beth"],
  kate: ["katherine", "kathryn"],
  katie: ["katherine", "kathryn"],
  katherine: ["kate", "katie"],
  kathryn: ["kate", "katie"],
  max: ["maximilian", "maxwell"],
  maximilian: ["max"],
  maxwell: ["max"],
  zach: ["zachary"],
  zachary: ["zach"],
  joe: ["joseph"],
  joseph: ["joe"],
  nate: ["nathan", "nathaniel"],
  nathan: ["nate"],
  nathaniel: ["nate"],
  greg: ["gregory"],
  gregory: ["greg"],
  ed: ["edward"],
  eddie: ["edward"],
  edward: ["ed", "eddie"],
  tony: ["anthony"],
  anthony: ["tony"],
};

interface Contact {
  name: string;
  first: string;
  last: string;
  nick: string;
  org: string;
  phones: string[];
  emails: string[];
}

interface ContactHandlesOutput {
  [personId: string]: { name: string; starred: boolean; phones: string[]; emails: string[] };
}

interface LinkReport {
  summary: {
    total: number;
    exact: number;
    contains: number;
    nickname: number;
    firstOnlyUnique: number;
    unmatched: number;
    phoneSet: number;
    emailSet: number;
  };
  unmatched: Array<{ id: string; name: string; company: string | null }>;
  multiCard: Array<{
    id: string;
    name: string;
    cards: Contact[];
    phones: string[];
    emails: string[];
  }>;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function exportContacts(): Contact[] {
  mkdirSync(dataDir, { recursive: true });

  // Check cache
  if (existsSync(contactsPath) && !refresh) {
    const stat = statSync(contactsPath);
    const ageMs = Date.now() - stat.mtime.getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      console.log("Using cached contacts (< 24h old).");
      return JSON.parse(readFileSync(contactsPath, "utf8"));
    }
  }

  // Export via osascript (JXA bulk approach)
  const jxa = `
    const app = Application("Contacts");
    app.includeStandardAdditions = true;
    const people = app.people; // specifier, not a call: enables bulk property access
    
    // Bulk property access: one Apple Event per property for all 6,800+
    // cards, instead of two per card (which takes minutes).
    const names = people.name();
    const firsts = people.firstName();
    const lasts = people.lastName();
    const nicks = people.nickname();
    const orgs = people.organization();
    const phones = people.phones.value();
    const emails = people.emails.value();

    const out = [];
    for (let i = 0; i < names.length; i++) {
      out.push({
        name: names[i] || "",
        first: firsts[i] || "",
        last: lasts[i] || "",
        nick: nicks[i] || "",
        org: orgs[i] || "",
        phones: phones[i] || [],
        emails: emails[i] || []
      });
    }
    JSON.stringify(out);
  `;

  const result = execFileSync("osascript", ["-l", "JavaScript", "-e", jxa], {
    encoding: "utf8",
  });
  const contacts = JSON.parse(result) as Contact[];
  writeFileSync(contactsPath, JSON.stringify(contacts, null, 2));
  console.log(`Exported ${contacts.length} contacts.`);
  return contacts;
}

function normalizePhone(p: string): string {
  const digits = p.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\+/.test(digits)) return digits;
  // Keep digits with + if no leading +
  return `+${digits.replace(/[^\d]/g, "")}` || "";
}

function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

async function main() {
  try {
    const contacts = exportContacts();
    const founderEmail = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
    const founder = await prisma.user.findUnique({ where: { email: founderEmail } });
    if (!founder) throw new Error(`founder user (${founderEmail}) not found`);

    const people = await prisma.person.findMany({
      where: { userId: founder.id, archived: false },
    });

    let exact = 0,
      contains_ct = 0,
      nickname_ct = 0,
      firstOnlyUnique_ct = 0;
    const unmatched: typeof people = [];
    const multiCardPeople: Array<{
      person: (typeof people)[0];
      cards: Contact[];
    }> = [];
    const handles: ContactHandlesOutput = {};
    let phoneSet = 0,
      emailSet = 0;

    for (const person of people) {
      const fullName = normalize(`${person.firstName} ${person.lastName ?? ""}`);
      const tokens = fullName.split(/\s+/).filter(Boolean);
      const pf = tokens[0];
      const pl = tokens.length > 1 ? tokens[tokens.length - 1] : "";

      // Match tiers
      let matched: Contact[] = [];
      let tier: "exact" | "contains" | "nickname" | "firstOnlyUnique" | null = null;

      // Exact
      matched = contacts.filter(
        (c) =>
          normalize(c.name) === fullName ||
          normalize(`${c.first} ${c.last}`) === fullName
      );
      if (matched.length > 0) tier = "exact";

      // Contains (requires pl)
      if (matched.length === 0 && pl) {
        matched = contacts.filter((c) => {
          const cLast = normalize(c.last);
          const cFirst = normalize(c.first);
          const cNick = normalize(c.nick);
          const cName = normalize(c.name);
          return (
            cLast === pl &&
            (cFirst === pf ||
              cFirst.startsWith(pf + " ") ||
              cName.includes(fullName) ||
              cNick === pf)
          );
        });
        if (matched.length > 0) tier = "contains";
      }

      // Nickname (requires pl)
      if (matched.length === 0 && pl) {
        const nickAliases = NICK[pf] || [];
        matched = contacts.filter((c) => {
          const cLast = normalize(c.last);
          const cFirst = normalize(c.first);
          return cLast === pl && nickAliases.includes(cFirst);
        });
        if (matched.length > 0) tier = "nickname";
      }

      // FirstOnlyUnique (only for single-token names)
      if (matched.length === 0 && !pl) {
        const byFirst = contacts.filter(
          (c) => normalize(c.first) === pf
        );
        const noLast = byFirst.filter((c) => !c.last || c.last === "");
        if (noLast.length === 1) matched = noLast;
        else if (byFirst.length === 1) matched = byFirst;
        if (matched.length > 0) tier = "firstOnlyUnique";
      }

      if (matched.length === 0) {
        unmatched.push(person);
      } else {
        if (matched.length > 1) {
          multiCardPeople.push({ person, cards: matched });
        }
        if (tier === "exact") exact++;
        else if (tier === "contains") contains_ct++;
        else if (tier === "nickname") nickname_ct++;
        else if (tier === "firstOnlyUnique") firstOnlyUnique_ct++;

        // Collect handles
        const phones = new Set<string>();
        const emails = new Set<string>();

        if (person.phone) phones.add(normalizePhone(person.phone));
        if (person.email) emails.add(normalizeEmail(person.email));

        for (const card of matched) {
          for (const p of card.phones) {
            const np = normalizePhone(p);
            if (np) phones.add(np);
          }
          for (const e of card.emails) {
            const ne = normalizeEmail(e);
            if (ne) emails.add(ne);
          }
        }

        // DB write
        {
          const updates: Record<string, string> = {};
          if (!person.phone && phones.size > 0) {
            updates.phone = Array.from(phones)[0];
            phoneSet++;
          }
          if (!person.email && emails.size > 0) {
            updates.email = Array.from(emails)[0];
            emailSet++;
          }
          if (!dryRun && Object.keys(updates).length > 0) {
            await prisma.person.update({
              where: { id: person.id },
              data: updates,
            });
          }
        }

        // Store handles
        handles[person.id] = {
          name: `${person.firstName} ${person.lastName ?? ""}`.trim(),
          starred: person.starred,
          phones: Array.from(phones).sort(),
          emails: Array.from(emails).sort(),
        };
      }
    }

    // Write outputs
    const contactHandles: ContactHandlesOutput = {};
    for (const person of people) {
      const phones = new Set<string>();
      const emails = new Set<string>();

      if (person.phone) phones.add(normalizePhone(person.phone));
      if (person.email) emails.add(normalizeEmail(person.email));

      if (handles[person.id]) {
        handles[person.id].phones.forEach((p) => phones.add(p));
        handles[person.id].emails.forEach((e) => emails.add(e));
      }

      if (phones.size > 0 || emails.size > 0) {
        contactHandles[person.id] = {
          name: `${person.firstName} ${person.lastName ?? ""}`.trim(),
          starred: person.starred,
          phones: Array.from(phones).sort(),
          emails: Array.from(emails).sort(),
        };
      }
    }

    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, "contact-handles.json"),
      JSON.stringify(contactHandles, null, 2)
    );

    const report: LinkReport = {
      summary: {
        total: people.length,
        exact,
        contains: contains_ct,
        nickname: nickname_ct,
        firstOnlyUnique: firstOnlyUnique_ct,
        unmatched: unmatched.length,
        phoneSet,
        emailSet,
      },
      unmatched: unmatched.map((p) => ({
        id: p.id,
        name: p.firstName,
        company: p.company,
      })),
      multiCard: multiCardPeople.slice(0, 10).map(({ person, cards }) => ({
        id: person.id,
        name: `${person.firstName} ${person.lastName ?? ""}`.trim(),
        cards,
        phones: cards.flatMap((c) => c.phones),
        emails: cards.flatMap((c) => c.emails),
      })),
    };

    writeFileSync(
      join(dataDir, "link-report.json"),
      JSON.stringify(report, null, 2)
    );

    console.table(report.summary);
    console.log("\nFirst 30 unmatched:");
    unmatched.slice(0, 30).forEach((p) => console.log(`  ${p.firstName} ${p.lastName ?? ""}`.trimEnd()));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
