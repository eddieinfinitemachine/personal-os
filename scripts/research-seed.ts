/**
 * Adds an existing PDF to /research as a ready report (for reports made
 * outside the worker, e.g. in an interactive Claude Code session).
 *
 *   pnpm exec tsx scripts/research-seed.ts --user <userId> --file <path.pdf> --title "<title>" --topic "<topic>" [--summary "<text>"]
 *
 * Uploads the PDF to Vercel Blob at users/<userId>/research/<reportId>/… and
 * reads the page count with pdfinfo when it's installed. Needs DATABASE_URL and
 * BLOB_READ_WRITE_TOKEN (read from .env in the working directory).
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";
import { cleanSummary, cleanTitle, parsePdfPageCount, researchBlobKey } from "../src/lib/research/outputs";

const USAGE = 'Usage: pnpm exec tsx scripts/research-seed.ts --user <userId> --file <path.pdf> --title "<title>" --topic "<topic>" [--summary "<text>"]';

export type SeedArgs = { user: string; file: string; title: string; topic: string; summary: string | null };

export function parseSeedArgs(argv: string[]): SeedArgs {
  const values: Record<string, string> = {};
  const allowed = new Set(["--user", "--file", "--title", "--topic", "--summary"]);
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!allowed.has(flag)) throw new Error(`Unknown argument ${flag}\n${USAGE}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}\n${USAGE}`);
    values[flag.slice(2)] = value;
  }
  const title = cleanTitle(values.title ?? null);
  const topic = values.topic?.trim();
  if (!values.user || !values.file || !title || !topic) throw new Error(USAGE);
  return { user: values.user, file: values.file, title, topic, summary: cleanSummary(values.summary ?? null) };
}

async function pageCount(path: string): Promise<number | null> {
  try {
    const { stdout } = await promisify(execFile)("pdfinfo", [path], { timeout: 30_000, encoding: "utf8" });
    return parsePdfPageCount(stdout);
  } catch {
    return null;
  }
}

async function main(argv: string[]) {
  const args = parseSeedArgs(argv);
  try { process.loadEnvFile(".env"); } catch {}
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!process.env.DATABASE_URL || !token) throw new Error("DATABASE_URL and BLOB_READ_WRITE_TOKEN are required");

  const pdf = await readFile(args.file);
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error(`${args.file} is not a PDF`);
  const pages = await pageCount(args.file);

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { id: args.user }, select: { id: true } });
    if (!user) throw new Error(`No user ${args.user}`);
    // "running" until the upload lands, so the worker never claims it and no
    // ready card ever shows without a PDF.
    const report = await prisma.researchReport.create({
      data: { userId: user.id, title: args.title, topic: args.topic, summary: args.summary, status: "running", startedAt: new Date() },
      select: { id: true },
    });
    try {
      const blob = await put(researchBlobKey(user.id, report.id), pdf, {
        access: "public", addRandomSuffix: false, contentType: "application/pdf", token,
      });
      await prisma.researchReport.update({
        where: { id: report.id },
        data: { status: "ready", pdfUrl: blob.url, pageCount: pages, completedAt: new Date() },
      });
      console.log(`Seeded research report ${report.id} (${pages ?? "?"} pages): ${blob.url}`);
    } catch (error) {
      await prisma.researchReport.delete({ where: { id: report.id } }).catch(() => {});
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
