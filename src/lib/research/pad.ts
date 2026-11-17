// A finished research report as an EC Pad note: the run's report.md with its
// picture links moved under images/<reportId>/, a link to the illustrated PDF
// and a closing provenance line. Pure: the Mac worker does the file work
// (scripts/lib/research-pad.ts).

const MAX_NOTE_NAME_CHARS = 120;
const FALLBACK_NOTE_NAME = "Research report";
const IMAGE_LINK = /\]\(images\/([^)\s]+)\)/g;

/** A note's base name (no ".md") that is safe as a file name in EC Pad's iCloud folder. */
export function padNoteFileName(title: string): string {
  const cleaned = title
    // Line breaks and tabs become spaces before the other control characters go.
    .replace(/\s+/g, " ")
    .replace(/[/:\\?*"<>|\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  const capped = Array.from(cleaned).slice(0, MAX_NOTE_NAME_CHARS).join("").trimEnd();
  return capped || FALLBACK_NOTE_NAME;
}

/** One file directly inside images/: no subfolders, no "..", no hidden files. */
function isSafeImageFile(file: string): boolean {
  return !file.includes("/") && !file.includes("\\") && !file.includes("..") && !file.startsWith(".");
}

/** File names the Markdown links as ](images/<file>), once each, unsafe ones left out. */
export function referencedImages(markdown: string): string[] {
  const files = new Set<string>();
  for (const match of markdown.matchAll(IMAGE_LINK)) {
    if (isSafeImageFile(match[1])) files.add(match[1]);
  }
  return [...files];
}

function localDate(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function padNoteMarkdown(
  markdown: string,
  options: { title: string; reportId: string; pdfUrl: string | null; pageCount: number | null; date: Date },
): string {
  const { title, reportId, pdfUrl, pageCount, date } = options;
  let text = markdown.replace(/\r\n?/g, "\n").replace(/^\n+/, "");
  if (!/^# \S/.test(text.trimStart())) text = `# ${title}\n\n${text}`;
  else text = text.trimStart();
  text = text.replace(IMAGE_LINK, (link, file: string) => (isSafeImageFile(file) ? `](images/${reportId}/${file})` : link));

  const newline = text.indexOf("\n");
  const titleLine = newline === -1 ? text : text.slice(0, newline);
  const body = (newline === -1 ? "" : text.slice(newline + 1)).replace(/^\n+/, "").trimEnd();
  const pages = pageCount == null ? "" : ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
  const parts = [
    titleLine.trimEnd(),
    ...(pdfUrl ? [`[Illustrated PDF](${pdfUrl})${pages}`] : []),
    ...(body ? [body] : []),
    `From Claude Code · ${localDate(date)} · research report ${reportId}`,
  ];
  return `${parts.join("\n\n")}\n`;
}
