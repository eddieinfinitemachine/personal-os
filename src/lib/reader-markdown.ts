import TurndownService from "turndown";

// Converts a Reader item's sanitized article HTML (`ReaderItem.contentHtml`) to
// Markdown for readers outside the web app (EC Pad's Read Later notes).
//
// Pure and deterministic: the same HTML and URL always give the same text, so a
// client can hash the result to tell an unchanged article from an edited note.
//
// The output is plain CommonMark + GFM tables, shaped for an editor that shows
// the Markdown source with its syntax hidden:
// - no backslash escapes (they would show as stray backslashes);
// - every link and image URL is absolute, with parentheses and spaces encoded
//   so a `)` inside a URL never ends the link early;
// - every image is its own paragraph (editors draw a picture only there);
// - a table always gets a header row (its first row when it has no <th>), and a
//   one-column layout table is unwrapped to its content.
// An item whose extraction failed has empty contentHtml and converts to "".

const REMOVED = [
  "script",
  "style",
  "noscript",
  "template",
  "nav",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "dialog",
] as const;

type Element = TurndownService.Node & HTMLElement;

export function readerHtmlToMarkdown(html: string, baseUrl: string): string {
  if (!html || !html.trim()) return "";
  const service = createService(baseUrl);
  return tidy(service.turndown(html));
}

function createService(baseUrl: string): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  // Escapes show as literal backslashes in a source-view editor; plain text it is.
  service.escape = (text: string) => text;
  service.remove([...REMOVED] as TurndownService.Filter);

  service.addRule("strikethrough", {
    filter: ["del", "s", "strike"] as TurndownService.Filter,
    replacement: (content) => (content.trim() ? `~~${content}~~` : ""),
  });

  service.addRule("listItem", {
    filter: "li",
    replacement: (content, node) => {
      const element = node as Element;
      const parent = element.parentNode as Element | null;
      let prefix = "- ";
      if (parent?.nodeName === "OL") {
        const start = Number.parseInt(parent.getAttribute("start") ?? "", 10);
        const index = Array.prototype.indexOf.call(parent.children, element) as number;
        prefix = `${(Number.isFinite(start) ? start : 1) + index}. `;
      }
      const indent = " ".repeat(prefix.length);
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n(?=.)/g, `\n${indent}`);
      return prefix + body + (element.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  service.addRule("preformatted", {
    filter: (node) => node.nodeName === "PRE" && node.firstChild?.nodeName !== "CODE",
    replacement: (_content, node) => fencedBlock((node as Element).textContent ?? ""),
  });

  service.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const element = node as Element;
      const src = absoluteUrl(element.getAttribute("src") || element.getAttribute("data-src") || "", baseUrl);
      const alt = inlineText(element.getAttribute("alt") ?? "");
      if (!src || !/^https?:/i.test(src)) return alt;
      return `\n\n![${alt}](${src})\n\n`;
    },
  });

  service.addRule("link", {
    filter: (node) => node.nodeName === "A" && Boolean((node as Element).getAttribute("href")),
    replacement: (content, node) => {
      const text = content.trim();
      if (!text) return "";
      // A linked picture reads as the picture alone (editors draw only a bare image).
      if (/^!\[[^\]\n]*\]\([^)\s]*\)$/.test(text)) return `\n\n${text}\n\n`;
      const href = absoluteUrl((node as Element).getAttribute("href") ?? "", baseUrl);
      if (!href || !/^(https?|mailto):/i.test(href)) return content;
      return `[${inlineText(text)}](${href})`;
    },
  });

  service.addRule("table", {
    filter: "table",
    replacement: (content, node) => {
      const rows = tableRows(node as Element).map((row) =>
        row.map((cell) => tableCell(service.turndown(cell.innerHTML))),
      );
      const columns = Math.max(0, ...rows.map((row) => row.length));
      // A layout table (one column) is not data: keep its words, drop the grid.
      if (rows.length === 0 || columns <= 1) return `\n\n${content.trim()}\n\n`;
      const padded = rows.map((row) => [...row, ...Array<string>(columns - row.length).fill("")]);
      const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
      const [header, ...body] = padded;
      const separator = line(Array<string>(columns).fill("---"));
      return `\n\n${[line(header), separator, ...body.map(line)].join("\n")}\n\n`;
    },
  });

  return service;
}

/** The rows of `table` (not of tables nested in it), header rows first, each as its cells. */
function tableRows(table: Element): Element[][] {
  const head: Element[] = [];
  const rest: Element[] = [];
  for (const child of Array.from(table.children) as Element[]) {
    const name = child.nodeName;
    if (name === "TR") rest.push(child);
    else if (name === "THEAD") head.push(...(Array.from(child.children) as Element[]).filter((r) => r.nodeName === "TR"));
    else if (name === "TBODY" || name === "TFOOT") {
      rest.push(...(Array.from(child.children) as Element[]).filter((r) => r.nodeName === "TR"));
    }
  }
  return [...head, ...rest]
    .map((row) => (Array.from(row.children) as Element[]).filter((c) => c.nodeName === "TH" || c.nodeName === "TD"))
    .filter((cells) => cells.length > 0);
}

/** One cell on one line: its Markdown with line breaks as spaces and pipes escaped. */
function tableCell(markdown: string): string {
  return markdown.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function fencedBlock(code: string): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `\n\n${fence}\n${code.replace(/\n$/, "")}\n${fence}\n\n`;
}

/** Link or alt text on one line, without brackets that would end it early. */
function inlineText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")").trim();
}

/** `href` resolved against the article's URL, with the characters that end a Markdown URL encoded. */
function absoluteUrl(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  let url: URL;
  try {
    url = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }
  return url.href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (/^\s+$/.test(line) ? "" : line))
    .join("\n")
    // The spaces an inline image's own paragraph left behind on either side.
    .replace(/[ \t]+\n\n(?=!\[)/g, "\n\n")
    .replace(/^(!\[[^\]\n]*\]\([^)\s]*\))\n\n[ \t]+/gm, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
