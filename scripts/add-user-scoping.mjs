#!/usr/bin/env node
// Adds `userId` + `user User @relation(...)` to every data model in schema.prisma,
// and emits the matching back-references on the User model.
// Safe to re-run — skips models that already have a userId field.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(__dirname, "..", "prisma", "schema.prisma");

// Models that should NOT be user-scoped.
const SKIP = new Set(["User", "MagicLinkToken"]);

const src = fs.readFileSync(SCHEMA, "utf8");

// Match `model Foo { ... }` blocks (non-greedy).
const modelRegex = /model (\w+) \{([\s\S]*?)\n\}/g;

const addedModels = [];
let out = src.replace(modelRegex, (match, name, body) => {
  if (SKIP.has(name)) return match;
  if (/^\s+userId\s+String/m.test(body)) return match; // already scoped
  addedModels.push(name);

  // Find the first `@@` line (indexes etc) — inject the relation fields just before it.
  // If there are no `@@` lines, inject just before the closing brace.
  const lines = body.split("\n");
  const insertIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*@@/.test(lines[i])) return i;
    }
    return lines.length;
  })();

  // Nullable on first push — backfill, then we'll flip to required and push again.
  const inject = [
    "",
    "  userId String?",
    "  user   User?  @relation(fields: [userId], references: [id], onDelete: Cascade)",
    "",
  ];
  // Add a userId index for fast scans.
  const indexLine = `  @@index([userId])`;
  // Insert relation fields before @@... block, then add @@index for userId.
  lines.splice(insertIdx, 0, ...inject);
  // Insert @@index([userId]) at end of model just before close (it will end up among other @@ lines).
  lines.push(indexLine);

  return `model ${name} {${lines.join("\n")}\n}`;
});

// Build back-references for User.
const backRefs = addedModels
  .map((m) => {
    const plural = pluralize(m);
    const field = camelLower(plural);
    return `  ${field.padEnd(28)} ${m}[]`;
  })
  .join("\n");

// Inject back-references into User model just before its closing brace + @@index.
out = out.replace(/model User \{([\s\S]*?)\n\}/, (match, body) => {
  if (body.includes("// auto-generated back-references")) return match;
  const lines = body.split("\n");
  const closeIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*@@/.test(lines[i])) return i;
    }
    return lines.length;
  })();
  lines.splice(closeIdx, 0, "", "  // auto-generated back-references", backRefs, "");
  return `model User {${lines.join("\n")}\n}`;
});

fs.writeFileSync(SCHEMA, out);

console.log(`Updated ${addedModels.length} models:`);
for (const m of addedModels) console.log(`  - ${m}`);

function camelLower(s) {
  return s[0].toLowerCase() + s.slice(1);
}

function pluralize(name) {
  // Crude pluralization — fine for our model names.
  if (name.endsWith("y") && !/[aeiou]y$/.test(name)) return name.slice(0, -1) + "ies";
  if (/(s|x|ch|sh)$/.test(name)) return name + "es";
  return name + "s";
}
