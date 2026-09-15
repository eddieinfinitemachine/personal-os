import { JSDOM } from "jsdom";
import {
  buildEpub,
  kindleFilename,
  type EpubImage,
} from "@/lib/kindle-epub";
import { safeFetch } from "@/lib/safe-fetch";

const MAX_INLINE_IMAGES = 40;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 22 * 1024 * 1024;
const IMAGE_DEADLINE_MS = 20_000;
const IMAGE_CONCURRENCY = 6;

export type SniffedImageType =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "svg"
  | null;

type ImageSource =
  | { kind: "url"; value: string }
  | { kind: "data"; value: Buffer };

type ImageCandidate = {
  element: HTMLImageElement | null;
  inlineIndex: number | null;
  source: ImageSource;
};

type ProcessedImage = {
  candidate: ImageCandidate;
  data: Buffer;
  type: "jpeg" | "png" | "gif";
  converted: boolean;
};

export function sniffImageType(buffer: Buffer): SniffedImageType {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "png";
  }
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") return "gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["avif", "avis"].includes(buffer.subarray(8, 12).toString("ascii"))
  ) {
    return "avif";
  }

  const text = buffer.subarray(0, 4096).toString("utf8").trimStart().toLowerCase();
  if (
    text.startsWith("<svg") ||
    (text.startsWith("<?xml") && /<svg(?:\s|>)/.test(text))
  ) {
    return "svg";
  }
  return null;
}

function rasterWidth(buffer: Buffer, type: "jpeg" | "png" | "gif"): number | null {
  if (type === "png") {
    return buffer.length >= 24 ? buffer.readUInt32BE(16) : null;
  }
  if (type === "gif") {
    return buffer.length >= 10 ? buffer.readUInt16LE(6) : null;
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      return buffer.readUInt16BE(offset + 5);
    }
    offset += length;
  }
  return null;
}

function decodeDataImage(raw: string): Buffer | null {
  const comma = raw.indexOf(",");
  if (comma < 0 || !/^data:image\/[^;,]+;base64$/i.test(raw.slice(0, comma))) {
    return null;
  }
  const encoded = raw.slice(comma + 1).replace(/\s/g, "");
  if (
    encoded.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 ||
    !/^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i.test(encoded)
  ) {
    return null;
  }
  const data = Buffer.from(encoded, "base64");
  return data.length <= MAX_IMAGE_BYTES ? data : null;
}

function resolveImageSource(raw: string, baseUrl: string): ImageSource | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^data:/i.test(value)) {
    const data = decodeDataImage(value);
    return data ? { kind: "data", value: data } : null;
  }
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { kind: "url", value: url.toString() };
  } catch {
    return null;
  }
}

async function convertToJpeg(buffer: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(buffer)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function loadCandidate(
  candidate: ImageCandidate,
  deadline: number,
): Promise<ProcessedImage | null> {
  if (Date.now() >= deadline) return null;

  let data: Buffer;
  if (candidate.source.kind === "data") {
    data = candidate.source.value;
  } else {
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return null;
      const response = await safeFetch(candidate.source.value, {
        accept: "image/jpeg,image/png,image/gif;q=0.9,*/*;q=0.1",
        maxBytes: MAX_IMAGE_BYTES,
        timeoutMs: Math.max(1, Math.min(15_000, remainingMs)),
      });
      if (response.status < 200 || response.status >= 300) return null;
      data = response.body;
    } catch {
      return null;
    }
  }

  const sniffed = sniffImageType(data);
  if (sniffed === "svg" || sniffed === null) return null;

  if (sniffed === "webp" || sniffed === "avif") {
    const converted = await convertToJpeg(data);
    return converted
      ? { candidate, data: converted, type: "jpeg", converted: true }
      : null;
  }

  const width = rasterWidth(data, sniffed);
  if (width !== null && width > 1600) {
    const converted = await convertToJpeg(data);
    return converted
      ? { candidate, data: converted, type: "jpeg", converted: true }
      : null;
  }
  return { candidate, data, type: sniffed, converted: false };
}

async function processCandidates(
  candidates: ImageCandidate[],
  deadline: number,
): Promise<Array<ProcessedImage | null>> {
  const results: Array<ProcessedImage | null> = Array.from(
    { length: candidates.length },
    () => null,
  );
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;
      results[index] = await loadCandidate(candidates[index], deadline);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_CONCURRENCY, candidates.length) },
      worker,
    ),
  );
  return results;
}

function extension(type: "jpeg" | "png" | "gif"): string {
  return type === "jpeg" ? "jpg" : type;
}

function mediaType(type: "jpeg" | "png" | "gif"): EpubImage["mediaType"] {
  return `image/${type}` as EpubImage["mediaType"];
}

export async function renderKindleEpub(article: {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  imageUrl: string | null;
  contentHtml: string;
  savedAt: Date;
}): Promise<{
  buffer: Buffer;
  filename: string;
  images: { kept: number; dropped: number; converted: number };
}> {
  const document = JSDOM.fragment(article.contentHtml).ownerDocument;
  const container = document.createElement("div");
  container.append(JSDOM.fragment(article.contentHtml));
  const imageElements = Array.from(container.querySelectorAll("img"));
  const candidates: ImageCandidate[] = [];
  let dropped = 0;

  let coverCandidate: ImageCandidate | null = null;
  if (article.imageUrl?.trim()) {
    const source = resolveImageSource(article.imageUrl, article.url);
    if (source) {
      coverCandidate = { element: null, inlineIndex: null, source };
      candidates.push(coverCandidate);
    } else {
      dropped += 1;
    }
  }

  for (const [index, element] of imageElements.entries()) {
    if (index >= MAX_INLINE_IMAGES) {
      element.remove();
      dropped += 1;
      continue;
    }
    const raw =
      element.getAttribute("src")?.trim() ||
      element.getAttribute("data-src")?.trim() ||
      "";
    const source = resolveImageSource(raw, article.url);
    if (!source) {
      element.remove();
      dropped += 1;
      continue;
    }
    candidates.push({ element, inlineIndex: index, source });
  }

  const processed = await processCandidates(
    candidates,
    Date.now() + IMAGE_DEADLINE_MS,
  );
  for (let index = 0; index < processed.length; index += 1) {
    if (processed[index]) continue;
    candidates[index].element?.remove();
    dropped += 1;
  }

  const retained = processed.filter(
    (image): image is ProcessedImage => image !== null,
  );
  let totalBytes = retained.reduce((total, image) => total + image.data.length, 0);
  const budgetDrops = new Set<ProcessedImage>();
  for (const image of [...retained].sort((a, b) => b.data.length - a.data.length)) {
    if (totalBytes <= MAX_TOTAL_IMAGE_BYTES) break;
    totalBytes -= image.data.length;
    budgetDrops.add(image);
    image.candidate.element?.remove();
    dropped += 1;
  }

  const kept = retained.filter((image) => !budgetDrops.has(image));
  const coverImage =
    coverCandidate === null
      ? null
      : kept.find((image) => image.candidate === coverCandidate) ?? null;
  const inlineImages = kept
    .filter((image) => image.candidate.inlineIndex !== null)
    .sort(
      (a, b) =>
        a.candidate.inlineIndex! - b.candidate.inlineIndex!,
    );

  const epubImages: EpubImage[] = [];
  let coverHref: string | null = null;
  if (coverImage) {
    coverHref = `images/cover.${extension(coverImage.type)}`;
    epubImages.push({
      href: coverHref,
      mediaType: mediaType(coverImage.type),
      data: coverImage.data,
    });
  }

  inlineImages.forEach((image, index) => {
    const href = `images/img-${String(index + 1).padStart(3, "0")}.${extension(image.type)}`;
    image.candidate.element!.setAttribute("src", href);
    epubImages.push({
      href,
      mediaType: mediaType(image.type),
      data: image.data,
    });
    if (!coverHref) coverHref = href;
  });

  const buffer = await buildEpub({
    title: article.title,
    author: article.byline,
    siteName: article.siteName,
    sourceUrl: article.url,
    savedAt: article.savedAt,
    contentHtml: container.innerHTML,
    images: epubImages,
    coverHref,
  });

  return {
    buffer,
    filename: kindleFilename(article.title),
    images: {
      kept: kept.length,
      dropped,
      converted: kept.filter((image) => image.converted).length,
    },
  };
}
