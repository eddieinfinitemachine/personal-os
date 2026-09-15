import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  extractArticle,
  extractArticleFromHtml,
} from "@/lib/reader-extract";
import { renderKindleEpub } from "@/lib/kindle";
import { sendKindleEmail } from "@/lib/email";

type CliArgs = {
  url: string;
  html?: string;
  out?: string;
  to?: string;
};

function usage(): string {
  return "Usage: pnpm kindle:send --url <url> [--html <saved-page.html>] [--out <file.epub>] [--to <kindle-address>]";
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};
  const allowed = new Set(["--url", "--html", "--out", "--to"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`Unknown argument: ${flag}\n${usage()}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}\n${usage()}`);
    }
    values[flag.slice(2) as keyof CliArgs] = value;
    index += 1;
  }
  if (!values.url) throw new Error(usage());
  return values as CliArgs;
}

function checkEpub(outputPath: string): boolean {
  const result = spawnSync("epubcheck", [outputPath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (
    result.error &&
    "code" in result.error &&
    result.error.code === "ENOENT"
  ) {
    console.log("epubcheck: not found on PATH (skipped)");
    return true;
  }
  if (result.error) throw result.error;

  const lines = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const diagnostics = lines.filter((line) => /\b(?:ERROR|FATAL)\b/i.test(line));
  for (const line of diagnostics) console.log(line);
  const summary =
    lines.find((line) => /^Messages:/i.test(line)) ??
    lines.find((line) => /No errors or warnings detected/i.test(line)) ??
    lines.find((line) => /EPUB is valid/i.test(line)) ??
    `epubcheck exit code: ${result.status ?? 1}`;
  console.log(`epubcheck: ${summary}`);

  return result.status === 0 && diagnostics.length === 0;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const article = args.html
    ? extractArticleFromHtml(args.url, await readFile(args.html, "utf8"))
    : await extractArticle(args.url);
  const rendered = await renderKindleEpub({
    url: article.url,
    title: article.title,
    byline: article.byline,
    siteName: article.siteName,
    imageUrl: article.imageUrl,
    contentHtml: article.contentHtml,
    savedAt: new Date(),
  });

  const outputPath = path.resolve(
    args.out ?? path.join("tmp-kindle", rendered.filename),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered.buffer);

  console.log(`Title: ${article.title}`);
  console.log(`Word count: ${article.wordCount}`);
  console.log(
    `Images: ${rendered.images.kept} kept, ${rendered.images.dropped} dropped, ${rendered.images.converted} converted`,
  );
  console.log(`EPUB size: ${formatBytes(rendered.buffer.length)}`);
  console.log(`Path: ${outputPath}`);

  if (!checkEpub(outputPath)) {
    process.exitCode = 1;
    return;
  }

  if (args.to) {
    const { id } = await sendKindleEmail({
      to: args.to,
      title: article.title,
      filename: rendered.filename,
      epub: rendered.buffer,
    });
    console.log(`Resend id: ${id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
