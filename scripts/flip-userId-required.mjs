#!/usr/bin/env node
// Flip every `userId String?` → `userId String` and `user User?` → `user User` in schema.prisma.
// Leaves User and MagicLinkToken untouched (they don't have these fields).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(__dirname, "..", "prisma", "schema.prisma");

let src = fs.readFileSync(SCHEMA, "utf8");

const before = src;
src = src.replaceAll("  userId String?\n", "  userId String\n");
src = src.replaceAll(
  "  user   User?  @relation(fields: [userId], references: [id], onDelete: Cascade)",
  "  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)",
);

if (src === before) {
  console.log("No changes — schema already uses required userId.");
  process.exit(0);
}

fs.writeFileSync(SCHEMA, src);
console.log("Flipped userId to required.");
