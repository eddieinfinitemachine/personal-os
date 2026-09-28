import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hash, IntakeError, string } from "./contracts";
import { lockOwner, sourceState } from "./store";
export async function createPairing(userId: string) {
  const state = await sourceState(userId, "ecpad");
  const code = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 600000);
  await prisma.datingSourceState.update({
    where: { id: state.id },
    data: { pairingHash: hash(code), pairingExpiresAt: expiresAt },
  });
  return { code, expiresAt: expiresAt.toISOString() };
}
export async function claimPairing(code: unknown, scope: unknown) {
  const c = string(code, 32);
  const library = string(scope, 100);
  if (!/^[a-f0-9]{32}$/.test(c) || !/^[a-zA-Z0-9-]{8,100}$/.test(library))
    throw new IntakeError("Invalid pairing details");
  const found = await prisma.datingSourceState.findFirst({
    where: {
      source: "ecpad",
      pairingHash: hash(c),
      pairingExpiresAt: { gt: new Date() },
    },
  });
  if (!found)
    throw new IntakeError("Pairing code expired or already used", 401);
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, found.userId);
    const claim = await tx.datingSourceState.updateMany({
      where: {
        id: found.id,
        pairingHash: hash(c),
        pairingExpiresAt: { gt: new Date() },
      },
      data: { pairingHash: null, pairingExpiresAt: null },
    });
    if (!claim.count)
      throw new IntakeError("Pairing code expired or already used", 401);
    await tx.datingSourceState.updateMany({
      where: { userId: found.userId, source: "ecpad" },
      data: {
        tokenHash: null,
        enabled: false,
        status: "paused",
        version: { increment: 1 },
      },
    });
    const token = randomBytes(32).toString("hex");
    const state = await tx.datingSourceState.upsert({
      where: {
        userId_source_scope: {
          userId: found.userId,
          source: "ecpad",
          scope: library,
        },
      },
      create: {
        userId: found.userId,
        source: "ecpad",
        scope: library,
        enabled: true,
        tokenHash: hash(token),
        status: "waiting_for_mac",
      },
      update: {
        enabled: true,
        tokenHash: hash(token),
        status: "waiting_for_mac",
      },
    });
    return { token, stateId: state.id };
  });
}
export async function connector(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new IntakeError("Unauthorized", 401);
  const state = await prisma.datingSourceState.findFirst({
    where: { source: "ecpad", tokenHash: hash(token) },
  });
  if (!state) throw new IntakeError("Unauthorized", 401);
  return state;
}
// Pairing uses unguessable 128-bit codes plus bounded per-instance attempts.
// No IP, code or token is persisted in plaintext or logged.
const attempts = new Map<string, { until: number; count: number }>();
export function throttlePairing(request: Request) {
  const key = hash(
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  );
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  if (attempts.size > 10000)
    throw new IntakeError("Pairing is busy. Try again shortly.", 429);
  const item = attempts.get(key) ?? { until: now + 60000, count: 0 };
  item.count++;
  attempts.set(key, item);
  if (item.count > 10)
    throw new IntakeError(
      "Too many pairing attempts. Try again in a minute.",
      429,
    );
}
