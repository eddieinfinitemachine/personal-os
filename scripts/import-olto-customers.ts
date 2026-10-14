// One-shot: import Infinite Machine Olto customers (Airtable "Vehicle & Sales
// Master" → People → view "All Olto Customers") into Eddie's Person table.
// Input is the Airtable list_records JSON dump. Dry run by default; --apply
// writes. Existing people (matched by Airtable id, email, phone, then full
// name) get tags merged and blank fields filled; nothing is overwritten.
//   pnpm dlx tsx scripts/import-olto-customers.ts <records.json> [--apply]

import { readFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";

try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const prisma = new PrismaClient();
type Rec = { id: string; fields: Record<string, unknown> };
const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("usage: import-olto-customers.ts <records.json> [--apply]");
const apply = flag === "--apply";
const records: Rec[] = JSON.parse(readFileSync(file, "utf8")).records;

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const norm = (v?: string | null) => (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const digits = (v?: string | null) => (v ?? "").replace(/\D/g, "").slice(-10);
function properCase(name: string) {
  // Only fix names typed in all caps or all lowercase; leave mixed case alone.
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
}
function tagsFor(f: Record<string, unknown>) {
  const tags = ["Olto customer"];
  const stage = s(f.Stage);
  if (stage) tags.push(`Olto: ${stage}`);
  if (arr(f.Vehicle).some(v => v === "P1" || v === "Both")) tags.push("P1 customer");
  if (arr(f["Relationship to IM"]).some(r => r.startsWith("Investor"))) tags.push("IM investor");
  return tags;
}
function noteFor(f: Record<string, unknown>) {
  const bits = [
    `Olto customer${s(f.Stage) ? ` · ${s(f.Stage)}` : ""}`,
    s(f.Color) ? `Color: ${s(f.Color)}` : null,
    typeof f["Order Count"] === "number" ? `Orders: ${f["Order Count"]}` : null,
    typeof f["Total Spent"] === "number" ? `Spent: $${Math.round(f["Total Spent"] as number).toLocaleString("en-US")}` : null,
    s(f.Source) ? `Source: ${s(f.Source)}` : null,
    s(f["IG/X"]) ? `IG/X: ${s(f["IG/X"])}` : null,
    s(f["Use Case"]) ? `Use case: ${s(f["Use Case"])}` : null,
  ].filter(Boolean);
  return `[Infinite Machine CRM] ${bits.join(" · ")}`;
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: process.env.FOUNDER_EMAIL ?? "emcohen@me.com" } });
  if (!user) throw new Error("founder user missing");
  const people = await prisma.person.findMany({ where: { userId: user.id } });
  const byExt = new Map(people.filter(p => p.externalId).map(p => [p.externalId!, p]));
  const byEmail = new Map(people.filter(p => p.email).map(p => [norm(p.email), p]));
  const byPhone = new Map(people.filter(p => digits(p.phone).length === 10).map(p => [digits(p.phone), p]));
  const byName = new Map(people.map(p => [norm(`${p.firstName} ${p.lastName ?? ""}`), p]));

  let created = 0, updated = 0, skipped = 0;
  for (const r of records) {
    const f = r.fields;
    const name = s(f.Name);
    if (!name) { skipped++; continue; }
    const email = s(f.Email), phone = s(f.Phone);
    const existing = byExt.get(r.id) ?? (email && byEmail.get(norm(email))) ?? (phone && byPhone.get(digits(phone))) ?? byName.get(norm(name)) ?? null;
    const tags = tagsFor(f);
    const linkedin = s(f.LinkedIn);
    const note = noteFor(f);

    if (existing) {
      const merged = [...new Set([...existing.tags, ...tags])];
      const social = (existing.socialUrls && typeof existing.socialUrls === "object" && !Array.isArray(existing.socialUrls) ? existing.socialUrls : {}) as Record<string, unknown>;
      const data: Prisma.PersonUpdateInput = {
        tags: merged,
        email: existing.email ?? email,
        phone: existing.phone ?? phone,
        city: existing.city ?? s(f.City),
        country: existing.country ?? s(f.Country),
        role: existing.role ?? s(f.Job),
        howWeMet: existing.howWeMet ?? "Infinite Machine customer",
        socialUrls: linkedin && !social.linkedin ? { ...social, linkedin } : undefined,
        notes: existing.notes?.includes("[Infinite Machine CRM]") ? undefined : existing.notes ? `${existing.notes}\n\n${note}` : note,
      };
      updated++;
      console.log(`update  ${name} -> ${existing.firstName} ${existing.lastName ?? ""} +[${tags.filter(t => !existing.tags.includes(t)).join(", ")}]`);
      if (apply) await prisma.person.update({ where: { id: existing.id }, data });
      continue;
    }

    const [firstName, ...rest] = properCase(name).split(/\s+/);
    const data: Prisma.PersonCreateInput = {
      user: { connect: { id: user.id } },
      externalId: r.id,
      firstName,
      lastName: rest.join(" ") || null,
      email, phone,
      city: s(f.City),
      country: s(f.Country),
      role: s(f.Job),
      tags,
      howWeMet: "Infinite Machine customer",
      socialUrls: linkedin ? { linkedin } : undefined,
      notes: note,
    };
    created++;
    console.log(`create  ${firstName} ${rest.join(" ")} [${tags.join(", ")}]`);
    if (apply) await prisma.person.create({ data });
  }
  console.log(`\n${apply ? "Applied" : "Dry run"}: ${created} created, ${updated} updated, ${skipped} skipped of ${records.length}.`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
