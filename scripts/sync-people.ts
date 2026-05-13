// Local one-shot script: pulls all People records from the "Eddie Personal"
// Airtable base and upserts into the Person table. Avoids Vercel's 60s
// function timeout. Run with `pnpm dlx tsx scripts/sync-people.ts`.

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Minimal .env loader so we don't need the dotenv dependency.
try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const prisma = new PrismaClient();

type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

async function fetchAll(baseId: string, tableId: string, apiKey: string) {
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      records: AirtableRecord[];
      offset?: string;
    };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v))
    return v.map((x) => str(x)).filter((x): x is string => !!x).join(", ") || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
  }
  return null;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x): x is string => !!x);
}

function date(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  const year = d.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return d;
}

async function main() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_PERSONAL_BASE;
  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_API_KEY or AIRTABLE_PERSONAL_BASE missing in .env");
  }

  console.log("Fetching People records from Airtable…");
  const records = await fetchAll(baseId, "tblEhdx9Dxg5AjzU1", apiKey);
  console.log(`Got ${records.length} records.`);

  const start = Date.now();
  let upserted = 0;
  const BATCH = 25;
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(async (r) => {
        const firstName = str(r.fields["First Name"]);
        if (!firstName) return;
        const data = {
          firstName,
          lastName: str(r.fields["Last Name"]),
          strength: str(r.fields["Strength"])?.toLowerCase() ?? null,
          circles: strArr(r.fields["Circle"]),
          tags: strArr(r.fields["Tags"]),
          email: str(r.fields["Email"]),
          phone: str(r.fields["Phone number"]),
          company: str(r.fields["Company"]),
          role: str(r.fields["Role"]),
          city: str(r.fields["Location"]),
          birthday: date(r.fields["Birthday"]),
          lastInteractionAt: date(r.fields["Last Interaction"]),
          notes: str(r.fields["Notes"]),
        };
        await prisma.person.upsert({
          where: { externalId: r.id },
          update: data,
          create: { externalId: r.id, ...data },
        });
        upserted++;
      })
    );
    process.stdout.write(`  upserted ${upserted}/${records.length}\r`);
  }
  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
