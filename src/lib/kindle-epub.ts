import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { JSDOM } from "jsdom";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const EPUB_NS = "http://www.idpf.org/2007/ops";
const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "video",
  "audio",
  "canvas",
  "svg",
  "math",
  "template",
  "link",
  "meta",
  "source",
  "track",
]);

const ALLOWED_ELEMENTS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "i",
  "b",
  "u",
  "s",
  "sub",
  "sup",
  "small",
  "mark",
  "span",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "figure",
  "figcaption",
  "img",
  "a",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "abbr",
  "cite",
  "q",
  "time",
  "del",
  "ins",
]);

const BLOCK_IN_PARAGRAPH =
  "figure, div, table, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, pre, p";

const STYLE_CSS = `body {
  margin: 5%;
  color: #111;
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.55;
}
header {
  margin-bottom: 2em;
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.2;
}
img {
  max-width: 100%;
  height: auto;
}
figcaption {
  font-size: 0.85em;
  font-style: italic;
}
blockquote {
  margin-left: 1.5em;
  padding-left: 1em;
  border-left: 0.2em solid #999;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
a {
  color: inherit;
}
`;

export type EpubImage = {
  href: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif";
  data: Buffer;
};

export type EpubInput = {
  title: string;
  author?: string | null;
  siteName?: string | null;
  sourceUrl: string;
  savedAt: Date;
  language?: string;
  contentHtml: string;
  images: EpubImage[];
  coverHref?: string | null;
};

function stripInvalidXmlCharacters(value: string): string {
  let clean = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      clean += character;
    }
  }
  return clean;
}

function isAllowedLink(href: string): boolean {
  const value = href.trim();
  if (value.startsWith("#")) return /^#[^\s]*$/.test(value);
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

function sanitizeElementAttributes(
  element: Element,
  allowedImages: ReadonlySet<string>,
  seenIds: Set<string>,
): boolean {
  const tag = element.localName.toLowerCase();
  const id = stripInvalidXmlCharacters(element.getAttribute("id") ?? "").trim();
  const title = stripInvalidXmlCharacters(
    element.getAttribute("title") ?? "",
  ).trim();
  const href = stripInvalidXmlCharacters(element.getAttribute("href") ?? "");
  const src = stripInvalidXmlCharacters(element.getAttribute("src") ?? "");
  const alt = stripInvalidXmlCharacters(element.getAttribute("alt") ?? "");
  const colspan = element.getAttribute("colspan") ?? "";
  const rowspan = element.getAttribute("rowspan") ?? "";

  for (const attribute of Array.from(element.attributes)) {
    element.removeAttribute(attribute.name);
  }

  if (id && !seenIds.has(id)) {
    element.setAttribute("id", id);
    seenIds.add(id);
  }
  if (title) element.setAttribute("title", title);

  if (tag === "a" && href.trim() && isAllowedLink(href)) {
    element.setAttribute("href", href.trim());
  }
  if (tag === "img") {
    if (!src || !allowedImages.has(src)) return false;
    element.setAttribute("src", src);
    element.setAttribute("alt", alt);
  }
  if ((tag === "td" || tag === "th") && /^[1-9]\d*$/.test(colspan)) {
    element.setAttribute("colspan", colspan);
  }
  if ((tag === "td" || tag === "th") && /^[1-9]\d*$/.test(rowspan)) {
    element.setAttribute("rowspan", rowspan);
  }
  return true;
}

function prepareContent(
  contentHtml: string,
  allowedImages: ReadonlySet<string>,
): HTMLDivElement {
  const fragment = JSDOM.fragment(contentHtml);
  const document = fragment.ownerDocument;
  const container = document.createElement("div");
  container.append(fragment);
  const seenIds = new Set<string>();

  const visit = (node: Node): void => {
    if (node.nodeType === node.TEXT_NODE) {
      node.nodeValue = stripInvalidXmlCharacters(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) {
      node.parentNode?.removeChild(node);
      return;
    }

    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      element.remove();
      return;
    }

    for (const child of Array.from(element.childNodes)) visit(child);

    if (!ALLOWED_ELEMENTS.has(tag)) {
      unwrap(element);
      return;
    }
    if (!sanitizeElementAttributes(element, allowedImages, seenIds)) {
      element.remove();
    }
  };

  for (const child of Array.from(container.childNodes)) visit(child);

  for (const anchor of Array.from(container.querySelectorAll("a"))) {
    let parent = anchor.parentElement;
    while (parent && parent !== container) {
      if (parent.localName.toLowerCase() === "a") {
        unwrap(anchor);
        break;
      }
      parent = parent.parentElement;
    }
  }

  for (const paragraph of Array.from(container.querySelectorAll("p"))) {
    if (!paragraph.querySelector(BLOCK_IN_PARAGRAPH)) continue;
    const replacement = document.createElement("div");
    for (const attribute of Array.from(paragraph.attributes)) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    replacement.append(...Array.from(paragraph.childNodes));
    paragraph.replaceWith(replacement);
  }

  for (const figure of Array.from(container.querySelectorAll("figure"))) {
    if (!figure.querySelector("img, figcaption")) unwrap(figure);
  }
  for (const wrapper of Array.from(container.querySelectorAll("a, span, p"))) {
    const hasMeaningfulContent =
      (wrapper.textContent ?? "").trim().length > 0 ||
      wrapper.querySelector("img, br, hr") !== null;
    if (!hasMeaningfulContent) wrapper.remove();
  }

  return container;
}

function createXmlDocument(namespace: string, rootName: string): XMLDocument {
  const document = new JSDOM("").window.document;
  return document.implementation.createDocument(namespace, rootName);
}

function appendSanitizedChildren(
  targetDocument: XMLDocument,
  target: Element,
  contentHtml: string,
  allowedImages: ReadonlySet<string>,
): void {
  const source = prepareContent(contentHtml, allowedImages);

  const copy = (node: Node): Node | null => {
    if (node.nodeType === node.TEXT_NODE) {
      return targetDocument.createTextNode(node.nodeValue ?? "");
    }
    if (node.nodeType !== node.ELEMENT_NODE) return null;

    const sourceElement = node as Element;
    const element = targetDocument.createElementNS(
      XHTML_NS,
      sourceElement.localName.toLowerCase(),
    );
    for (const attribute of Array.from(sourceElement.attributes)) {
      element.setAttribute(attribute.name, attribute.value);
    }
    for (const child of Array.from(sourceElement.childNodes)) {
      const copied = copy(child);
      if (copied) element.appendChild(copied);
    }
    return element;
  };

  for (const child of Array.from(source.childNodes)) {
    const copied = copy(child);
    if (copied) target.appendChild(copied);
  }
}

function serializeXml(document: XMLDocument): string {
  const serializer = new (new JSDOM("").window.XMLSerializer as any)();
  return `<?xml version="1.0" encoding="UTF-8"?>\n${(serializer as any).serializeToString(document)}`;
}

function createXhtmlDocument(language: string): XMLDocument {
  const implementation = new JSDOM("").window.document.implementation;
  const doctype = implementation.createDocumentType("html", "", "");
  const document = implementation.createDocument(XHTML_NS, "html", doctype);
  const root = document.documentElement;
  root.setAttributeNS(XML_NS, "xml:lang", language);
  root.setAttribute("lang", language);
  return document;
}

function appendTextElement(
  document: XMLDocument,
  parent: Element,
  name: string,
  value: string,
  namespace = parent.namespaceURI ?? XHTML_NS,
): Element {
  const element = document.createElementNS(namespace, name);
  element.textContent = stripInvalidXmlCharacters(value);
  parent.appendChild(element);
  return element;
}

function buildContainerXml(): string {
  const document = createXmlDocument(CONTAINER_NS, "container");
  const root = document.documentElement;
  root.setAttribute("version", "1.0");
  const rootfiles = document.createElementNS(CONTAINER_NS, "rootfiles");
  const rootfile = document.createElementNS(CONTAINER_NS, "rootfile");
  rootfile.setAttribute("full-path", "OEBPS/content.opf");
  rootfile.setAttribute("media-type", "application/oebps-package+xml");
  rootfiles.appendChild(rootfile);
  root.appendChild(rootfiles);
  return serializeXml(document);
}

function buildNavXhtml(title: string, language: string): string {
  const document = createXhtmlDocument(language);
  const root = document.documentElement;
  root.setAttributeNS(XMLNS_NS, "xmlns:epub", EPUB_NS);

  const head = document.createElementNS(XHTML_NS, "head");
  appendTextElement(document, head, "title", title);
  const body = document.createElementNS(XHTML_NS, "body");
  const nav = document.createElementNS(XHTML_NS, "nav");
  nav.setAttributeNS(EPUB_NS, "epub:type", "toc");
  const orderedList = document.createElementNS(XHTML_NS, "ol");
  const item = document.createElementNS(XHTML_NS, "li");
  const link = appendTextElement(document, item, "a", title);
  link.setAttribute("href", "article.xhtml");
  orderedList.appendChild(item);
  nav.appendChild(orderedList);
  body.appendChild(nav);
  root.append(head, body);
  return serializeXml(document);
}

function buildArticleXhtml(
  input: EpubInput,
  title: string,
  language: string,
  allowedImages: ReadonlySet<string>,
): string {
  const document = createXhtmlDocument(language);
  const root = document.documentElement;
  const head = document.createElementNS(XHTML_NS, "head");
  const meta = document.createElementNS(XHTML_NS, "meta");
  meta.setAttribute("charset", "utf-8");
  head.appendChild(meta);
  appendTextElement(document, head, "title", title);
  const stylesheet = document.createElementNS(XHTML_NS, "link");
  stylesheet.setAttribute("rel", "stylesheet");
  stylesheet.setAttribute("href", "style.css");
  head.appendChild(stylesheet);

  const body = document.createElementNS(XHTML_NS, "body");
  const header = document.createElementNS(XHTML_NS, "header");
  appendTextElement(document, header, "h1", title);

  const creatorParts = [input.author?.trim(), input.siteName?.trim()].filter(
    (part, index, parts): part is string =>
      Boolean(part) && parts.indexOf(part) === index,
  );
  if (creatorParts.length > 0) {
    appendTextElement(document, header, "p", creatorParts.join(" · "));
  }

  const sourceLine = document.createElementNS(XHTML_NS, "p");
  sourceLine.appendChild(
    document.createTextNode(
      `Saved ${input.savedAt.toISOString().slice(0, 10)} · `,
    ),
  );
  const sourceLink = appendTextElement(
    document,
    sourceLine,
    "a",
    input.sourceUrl,
  );
  sourceLink.setAttribute("href", input.sourceUrl);
  header.appendChild(sourceLine);
  body.appendChild(header);
  appendSanitizedChildren(
    document,
    body,
    input.contentHtml,
    allowedImages,
  );

  root.append(head, body);
  return serializeXml(document);
}

function buildContentOpf(
  input: EpubInput,
  title: string,
  language: string,
  identifier: string,
  coverHref: string | null,
): string {
  const document = createXmlDocument(OPF_NS, "package");
  const root = document.documentElement;
  root.setAttribute("version", "3.0");
  root.setAttribute("unique-identifier", "bookid");

  const metadata = document.createElementNS(OPF_NS, "metadata");
  const identifierElement = appendTextElement(
    document,
    metadata,
    "dc:identifier",
    identifier,
    DC_NS,
  );
  identifierElement.setAttribute("id", "bookid");
  appendTextElement(document, metadata, "dc:title", title, DC_NS);
  appendTextElement(document, metadata, "dc:language", language, DC_NS);
  const creator = input.author?.trim() || input.siteName?.trim();
  if (creator) {
    appendTextElement(document, metadata, "dc:creator", creator, DC_NS);
  }
  appendTextElement(
    document,
    metadata,
    "dc:source",
    input.sourceUrl,
    DC_NS,
  );
  const modified = appendTextElement(
    document,
    metadata,
    "meta",
    input.savedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    OPF_NS,
  );
  modified.setAttribute("property", "dcterms:modified");

  const manifest = document.createElementNS(OPF_NS, "manifest");
  const addItem = (
    id: string,
    href: string,
    mediaType: string,
    properties?: string,
  ): void => {
    const item = document.createElementNS(OPF_NS, "item");
    item.setAttribute("id", id);
    item.setAttribute("href", href);
    item.setAttribute("media-type", mediaType);
    if (properties) item.setAttribute("properties", properties);
    manifest.appendChild(item);
  };
  addItem("nav", "nav.xhtml", "application/xhtml+xml", "nav");
  addItem("article", "article.xhtml", "application/xhtml+xml");
  addItem("style", "style.css", "text/css");
  input.images.forEach((image, index) => {
    addItem(
      `image-${index + 1}`,
      image.href,
      image.mediaType,
      image.href === coverHref ? "cover-image" : undefined,
    );
  });

  const spine = document.createElementNS(OPF_NS, "spine");
  const itemref = document.createElementNS(OPF_NS, "itemref");
  itemref.setAttribute("idref", "article");
  spine.appendChild(itemref);
  root.append(metadata, manifest, spine);
  return serializeXml(document);
}

function validateInput(input: EpubInput): {
  title: string;
  language: string;
  coverHref: string | null;
} {
  const title = stripInvalidXmlCharacters(input.title).trim() || "Untitled";
  const language =
    stripInvalidXmlCharacters(input.language ?? "").trim() || "en";
  if (Number.isNaN(input.savedAt.getTime())) {
    throw new Error("savedAt must be a valid date");
  }
  const source = new URL(input.sourceUrl);
  if (source.protocol !== "http:" && source.protocol !== "https:") {
    throw new Error("sourceUrl must use http(s)");
  }

  const hrefs = new Set<string>();
  for (const image of input.images) {
    if (
      !/^images\/[a-zA-Z0-9._-]+\.(?:jpe?g|png|gif)$/i.test(image.href)
    ) {
      throw new Error(`Invalid EPUB image href: ${image.href}`);
    }
    if (hrefs.has(image.href)) {
      throw new Error(`Duplicate EPUB image href: ${image.href}`);
    }
    hrefs.add(image.href);
  }
  const coverHref = input.coverHref ?? null;
  if (coverHref && !hrefs.has(coverHref)) {
    throw new Error("coverHref must match an EPUB image");
  }
  return { title, language, coverHref };
}

export function toXhtmlBody(contentHtml: string): string {
  const document = createXmlDocument(XHTML_NS, "body");
  appendSanitizedChildren(document, document.documentElement, contentHtml, new Set());
  const serializer = new (new JSDOM("").window.XMLSerializer as any)();
  return Array.from(document.documentElement.childNodes)
    .map((node) => (serializer as any).serializeToString(node))
    .join("");
}

export function kindleFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return `${slug || "article"}.epub`;
}

export async function buildEpub(input: EpubInput): Promise<Buffer> {
  const { title, language, coverHref } = validateInput(input);
  const allowedImages = new Set(input.images.map((image) => image.href));
  const identifier = `urn:uuid:${randomUUID()}`;
  const containerXml = buildContainerXml();
  const contentOpf = buildContentOpf(
    input,
    title,
    language,
    identifier,
    coverHref,
  );
  const navXhtml = buildNavXhtml(title, language);
  const articleXhtml = buildArticleXhtml(
    input,
    title,
    language,
    allowedImages,
  );

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", {
    compression: "STORE",
    createFolders: false,
  });
  zip.file("META-INF/container.xml", containerXml, { createFolders: false });
  zip.file("OEBPS/content.opf", contentOpf, { createFolders: false });
  zip.file("OEBPS/nav.xhtml", navXhtml, { createFolders: false });
  zip.file("OEBPS/article.xhtml", articleXhtml, { createFolders: false });
  zip.file("OEBPS/style.css", STYLE_CSS, { createFolders: false });
  for (const image of input.images) {
    zip.file(`OEBPS/${image.href}`, image.data, { createFolders: false });
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
}
