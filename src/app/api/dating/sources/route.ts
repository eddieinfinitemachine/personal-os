import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { prisma } from "@/lib/prisma";
import { readJSON, object, IntakeError } from "@/lib/dating-intake/contracts";
import { createPairing } from "@/lib/dating-intake/auth";
import {
  sourceState,
  stateDTO,
  lockOwner,
  invalidate,
} from "@/lib/dating-intake/store";
import { failure } from "@/lib/dating-intake/http";
export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const states = await prisma.datingSourceState.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    const sources = ["ecpad", "texts", "granola"].map((source) => {
      const matches = states.filter((s) => s.source === source);
      const s =
        matches.find((s) => s.enabled) ||
        matches.find((s) => s.tokenHash) ||
        matches.find((s) => s.scope !== "default") ||
        matches[0];
      return s
        ? stateDTO(s)
        : {
            id: null,
            source,
            enabled: false,
            status: "not_connected",
            lastSuccessAt: null,
            lastAttemptAt: null,
            lastNewDataAt: null,
            backlog: 0,
            coverageStart: null,
            coverageEnd: null,
            error: null,
          };
    });
    return NextResponse.json(
      {
        sources,
        granolaAvailable:
          !!process.env.GRANOLA_API_KEY && (await isFounderUser(userId)),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId(request);
    if (!userId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const b = object(await readJSON(request, 2048));
    if (b.action === "pair")
      return NextResponse.json(await createPairing(userId), {
        headers: { "Cache-Control": "no-store" },
      });
    if (
      !["texts", "granola", "ecpad"].includes(String(b.source)) ||
      !["enable", "pause", "disconnect", "remove"].includes(String(b.action))
    )
      throw new IntakeError("Unknown source action");
    if (
      b.source === "granola" &&
      (!process.env.GRANOLA_API_KEY || !(await isFounderUser(userId)))
    )
      throw new IntakeError("Granola is not connected", 409);
    const state =
      typeof b.id === "string"
        ? await prisma.datingSourceState.findFirst({
            where: { id: b.id, userId, source: String(b.source) },
          })
        : await sourceState(userId, String(b.source));
    if (!state) throw new IntakeError("Source not found", 404);
    await prisma.$transaction(async (tx) => {
      await lockOwner(tx, userId);
      const current = await tx.datingSourceState.findFirst({
        where: { id: state.id, userId },
      });
      if (!current) throw new IntakeError("Source not found", 404);
      if (b.source === "ecpad" && b.action === "enable" && !current.tokenHash)
        throw new IntakeError("Pair EC Pad first", 409);
      if (b.source === "ecpad" && b.action === "disconnect") {
        // Pairing codes live on the default scope, while tokens live on library scopes.
        // Disconnect revokes both under the same lock as code issue and redemption.
        await tx.datingSourceState.updateMany({
          where: { userId, source: "ecpad" },
          data: {
            enabled: false,
            status: "paused",
            tokenHash: null,
            pairingHash: null,
            pairingExpiresAt: null,
            version: { increment: 1 },
          },
        });
        return;
      }
      if (b.action === "remove") {
        const records = await tx.datingSourceRecord.findMany({
          where: { userId, stateId: state.id },
          select: { id: true },
        });
        await invalidate(
          tx,
          userId,
          records.map((r) => r.id),
          "withdrawn",
        );
      }
      await tx.datingSourceState.update({
        where: { id: state.id },
        data: {
          enabled: b.action === "enable",
          status:
            b.action === "enable"
              ? b.source === "granola"
                ? "backlog"
                : "waiting_for_mac"
              : "paused",
          version: { increment: 1 },
          ...(b.action === "disconnect"
            ? { tokenHash: null, pairingHash: null }
            : {}),
          ...(b.action === "enable" &&
          b.source === "texts" &&
          !current.coverageStart
            ? { coverageStart: new Date(Date.now() - 30 * 86400000) }
            : {}),
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
