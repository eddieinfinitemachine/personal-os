/**
 * Import a Cosmos (cosmos.so) export onto the founder's mood board.
 *
 *   pnpm dlx tsx --env-file=.env scripts/import-cosmos.ts <export.json> [--dry-run] [--concurrency 6]
 *   pnpm dlx tsx --env-file=.env scripts/import-cosmos.ts --undo     # removes everything imported (via = "cosmos")
 *
 * The export is Cosmos's own GraphQL data: every element in every one of the
 * user's collections (public profile + private), gathered from a logged-in
 * browser session by paging `clusterConnections` per cluster and
 * `userClusters` for the collection list. Shape: see CosmosExport in
 * src/lib/cosmos-import.ts.
 *
 * Each element with a picture becomes one board row (one tile per Cosmos
 * element, like Cosmos shows it) with the image re-hosted to Blob as WebP,
 * `savedAt` = when it was saved on Cosmos, and its collection names as tags.
 * Elements Cosmos never rendered but that have a source URL are saved as
 * links through the normal save path (metadata fetch, oEmbed).
 *
 * Idempotent per element via a manifest written next to the export
 * (<export>.imported.json): re-running skips what already landed.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { deleteBoardImage, fetchImage, storeBoardImage } from "../src/lib/board";
import { saveToBoard } from "../src/lib/board-save";
import { isItemPlan, planElement, tagsForElement, type CosmosExport } from "../src/lib/cosmos-import";

const VIA = "cosmos";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const dryRun = flags.has("--dry-run");
const concurrency = Math.max(1, Number(arg("--concurrency") ?? 6));

async function founder() {
  const email = process.env.FOUNDER_EMAIL?.toLowerCase().trim() ?? "emcohen@me.com";
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error(`No user with email ${email}`);
  return user;
}

async function undo(userId: string) {
  const items = await prisma.boardItem.findMany({ where: { userId, via: VIA }, select: { id: true, imageUrl: true } });
  console.log(`${items.length} imported item(s) to remove`);
  if (dryRun) return;
  for (const it of items) await deleteBoardImage(userId, it.imageUrl);
  const { count } = await prisma.boardItem.deleteMany({ where: { userId, via: VIA } });
  console.log(`removed ${count}`);
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    }),
  );
}

async function main() {
  const user = await founder();
  console.log(`board owner: ${user.email}${dryRun ? " (dry run)" : ""}`);
  if (flags.has("--undo")) return undo(user.id);

  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== arg("--concurrency"));
  if (!file) throw new Error("usage: import-cosmos.ts <export.json> [--dry-run] [--undo]");
  const exp = JSON.parse(fs.readFileSync(file, "utf8")) as CosmosExport;
  const manifestPath = path.resolve(`${file}.imported.json`);
  const manifest: Record<string, string> = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};
  const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  const elements = [...exp.elements].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const stats = { images: 0, links: 0, skipped: 0, already: 0, remoteImage: 0, failed: 0 };
  const failed: Array<{ id: number; reason: string }> = [];
  const tagCounts = new Map<string, number>();

  const work = elements.filter((el) => {
    if (manifest[el.id]) {
      stats.already++;
      return false;
    }
    return true;
  });
  console.log(`${elements.length} elements in export, ${stats.already} already imported, ${work.length} to go`);

  let done = 0;
  await pool(work, dryRun ? 1 : concurrency, async (el) => {
    const plan = planElement(el);
    if (!plan) {
      stats.skipped++;
      return;
    }
    const tags = tagsForElement(exp, el.id);
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (dryRun) {
      if (isItemPlan(plan)) stats.images++;
      else stats.links++;
      return;
    }
    try {
      if (isItemPlan(plan)) {
        const body = await fetchImage(plan.imageSrc);
        const stored = body ? await storeBoardImage(user.id, body) : null;
        if (!stored) stats.remoteImage++;
        const item = await prisma.boardItem.create({
          data: {
            userId: user.id,
            kind: plan.kind,
            url: plan.url,
            title: plan.title,
            siteName: plan.siteName,
            ...(stored ?? { imageUrl: plan.imageSrc, imageWidth: plan.imageWidth, imageHeight: plan.imageHeight }),
            via: VIA,
            tags,
            savedAt: plan.savedAt,
          },
          select: { id: true },
        });
        manifest[el.id] = item.id;
        stats.images++;
      } else {
        const { item, duplicate } = await saveToBoard(user.id, { url: plan.url, via: VIA });
        if (!duplicate) {
          await prisma.boardItem.update({ where: { id: item.id }, data: { tags, savedAt: plan.savedAt } });
        }
        manifest[el.id] = item.id;
        stats.links++;
      }
    } catch (e) {
      stats.failed++;
      failed.push({ id: el.id, reason: e instanceof Error ? e.message : String(e) });
    }
    done++;
    if (done % 25 === 0) {
      saveManifest();
      console.log(`  ${done}/${work.length}`);
    }
  });
  if (!dryRun) saveManifest();

  console.log("\nresult", stats);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`tags (${tags.length}):`, tags.map(([t, n]) => `${t} ${n}`).join(" · "));
  if (failed.length) console.log("failed:", failed);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
