import type { DatingEvent, DatingMessage, DatingPerson } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanList, isEventKind, isStage, parseHandles } from "@/lib/dating";

export type DatingInsights = {
  summary?: string;
  remember?: string[];
  greenFlags?: string[];
  redFlags?: string[];
  lessons?: string;
  ideas?: string[];
};

export type DatingPersonDTO = Omit<
  DatingPerson,
  "userId" | "metAt" | "endedAt" | "insightsAt" | "lastMessageAt" | "createdAt" | "updatedAt" | "insights"
> & {
  metAt: string | null;
  endedAt: string | null;
  insightsAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  insights: DatingInsights | null;
};

export type DatingEventDTO = Omit<DatingEvent, "userId" | "occurredAt" | "createdAt"> & {
  occurredAt: string;
};

export type DatingMessageDTO = Pick<DatingMessage, "id" | "fromMe" | "text" | "source"> & { sentAt: string };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toPersonDTO(p: DatingPerson): DatingPersonDTO {
  const { userId: _u, updatedAt: _up, ...rest } = p;
  return {
    ...rest,
    metAt: iso(p.metAt),
    endedAt: iso(p.endedAt),
    insightsAt: iso(p.insightsAt),
    lastMessageAt: iso(p.lastMessageAt),
    createdAt: p.createdAt.toISOString(),
    insights: (p.insights ?? null) as DatingInsights | null,
  };
}

export function toEventDTO(e: DatingEvent): DatingEventDTO {
  const { userId: _u, createdAt: _c, ...rest } = e;
  return { ...rest, occurredAt: e.occurredAt.toISOString() };
}

export function toMessageDTO(m: Pick<DatingMessage, "id" | "fromMe" | "text" | "source" | "sentAt">): DatingMessageDTO {
  return { id: m.id, fromMe: m.fromMe, text: m.text, source: m.source, sentAt: m.sentAt.toISOString() };
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Whitelist the editable person fields out of a request body. Only keys
 * present in the body are returned, so PATCH leaves the rest alone.
 */
export function personPatch(body: Record<string, unknown>) {
  const data: Partial<{
    name: string;
    handles: string[];
    stage: string;
    metVia: string | null;
    metAt: Date | null;
    endedAt: Date | null;
    age: number | null;
    city: string | null;
    work: string | null;
    remember: string[];
    greenFlags: string[];
    redFlags: string[];
    notes: string | null;
    lessons: string | null;
  }> = {};
  if ("name" in body) {
    const n = str(body.name, 100);
    if (n) data.name = n;
  }
  if ("handles" in body) data.handles = parseHandles(body.handles);
  if ("stage" in body && isStage(body.stage)) {
    data.stage = body.stage;
    if (body.stage === "ended" && !("endedAt" in body)) data.endedAt = new Date();
  }
  if ("metVia" in body) data.metVia = str(body.metVia, 100);
  if ("metAt" in body) data.metAt = date(body.metAt);
  if ("endedAt" in body) data.endedAt = date(body.endedAt);
  if ("age" in body) {
    const a = Number(body.age);
    data.age = Number.isInteger(a) && a > 0 && a < 120 ? a : null;
  }
  if ("city" in body) data.city = str(body.city, 100);
  if ("work" in body) data.work = str(body.work, 200);
  if ("remember" in body) data.remember = cleanList(body.remember);
  if ("greenFlags" in body) data.greenFlags = cleanList(body.greenFlags);
  if ("redFlags" in body) data.redFlags = cleanList(body.redFlags);
  if ("notes" in body) data.notes = str(body.notes, 50_000);
  if ("lessons" in body) data.lessons = str(body.lessons, 20_000);
  return data;
}

export type IncomingMessage = {
  externalId: string;
  sentAt: Date;
  fromMe: boolean;
  text: string;
  source: "imessage" | "paste";
};

/** Insert messages (deduped by externalId) and bump the person's lastMessageAt. */
export async function ingestMessages(userId: string, personId: string, msgs: IncomingMessage[]) {
  if (!msgs.length) return 0;
  const res = await prisma.datingMessage.createMany({
    data: msgs.map((m) => ({
      userId,
      personId,
      externalId: m.externalId.slice(0, 200),
      sentAt: m.sentAt,
      fromMe: m.fromMe,
      text: m.text.slice(0, 20_000),
      source: m.source,
    })),
    skipDuplicates: true,
  });
  const latest = await prisma.datingMessage.findFirst({
    where: { personId },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (latest) {
    await prisma.datingPerson.update({ where: { id: personId }, data: { lastMessageAt: latest.sentAt } });
  }
  return res.count;
}

/** Whitelist editable event fields; only keys present in the body. */
export function eventPatch(body: Record<string, unknown>) {
  const data: Partial<{ title: string; kind: string; occurredAt: Date; notes: string | null; vibe: number | null }> = {};
  if ("title" in body) {
    const t = str(body.title, 200);
    if (t) data.title = t;
  }
  if ("kind" in body && isEventKind(body.kind)) data.kind = body.kind;
  if ("occurredAt" in body) {
    const d = date(body.occurredAt);
    if (d) data.occurredAt = d;
  }
  if ("notes" in body) data.notes = str(body.notes, 20_000);
  if ("vibe" in body) {
    const v = Number(body.vibe);
    data.vibe = body.vibe !== null && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null;
  }
  return data;
}
