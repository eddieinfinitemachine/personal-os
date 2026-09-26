import { prisma } from "@/lib/prisma";
import { InputError, shareCaption, type BoardInput } from "@/lib/board-input";
import { fetchImage, resolveLink, storeBoardImage, type StoredImage } from "@/lib/board";
import { displayHost } from "@/lib/board-embed";

function joinNote(...parts: Array<string | null | undefined>): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return kept.length ? kept.join("\n\n").slice(0, 4000) : null;
}

export async function saveToBoard(userId: string, input: BoardInput) {
  const via = input.via;

  if (input.image) {
    const stored = await storeBoardImage(userId, input.image);
    if (!stored) {
      throw new InputError("Couldn't read that image.", 415);
    }
    const item = await prisma.boardItem.create({
      data: {
        userId,
        kind: "image",
        url: input.url ?? null,
        title: input.title ?? null,
        note: joinNote(input.note, input.text),
        siteName: displayHost(input.url),
        ...stored,
        via,
      },
    });
    return { item, duplicate: false };
  }

  if (input.imageSrc) {
    const body = await fetchImage(input.imageSrc);
    const stored = body ? await storeBoardImage(userId, body) : null;
    const item = await prisma.boardItem.create({
      data: {
        userId,
        kind: "image",
        url: input.url ?? input.imageSrc,
        title: input.title ?? null,
        note: joinNote(input.note, input.text),
        siteName: displayHost(input.url ?? input.imageSrc),
        ...(stored ?? { imageUrl: input.imageSrc }),
        via,
      },
    });
    return { item, duplicate: false };
  }

  if (input.url) {
    // Re-sharing something bumps it back to the top instead of duplicating.
    const existing = await prisma.boardItem.findFirst({ where: { userId, url: input.url } });
    if (existing) {
      const note = input.note && !existing.note?.includes(input.note) ? joinNote(existing.note, input.note) : existing.note;
      const item = await prisma.boardItem.update({
        where: { id: existing.id },
        data: { savedAt: new Date(), note },
      });
      return { item, duplicate: true };
    }

    const link = await resolveLink(input.url);
    let stored: StoredImage | null = null;
    const body = link.imageBody ?? (link.imageSrc ? await fetchImage(link.imageSrc) : null);
    if (body) stored = await storeBoardImage(userId, body);

    const title = input.title ?? link.title;
    const item = await prisma.boardItem.create({
      data: {
        userId,
        kind: link.kind,
        url: link.url,
        title: title?.slice(0, 300) ?? null,
        note: joinNote(input.note, shareCaption(input.text, title)),
        siteName: link.siteName ?? displayHost(link.url),
        price: link.price,
        ...(stored ?? (link.imageSrc ? { imageUrl: link.imageSrc } : {})),
        via,
      },
    });
    return { item, duplicate: false };
  }

  const text = joinNote(input.note, input.text);
  if (!text) throw new InputError("Nothing to save: send a link, an image, or some text.");
  const item = await prisma.boardItem.create({
    data: { userId, kind: "note", note: text, title: input.title ?? null, via },
  });
  return { item, duplicate: false };
}
