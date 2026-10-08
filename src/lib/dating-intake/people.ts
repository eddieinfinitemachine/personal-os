import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hash, IntakeError } from "./contracts";
import { lockOwner, json } from "./store";
import { resolveIdentity, identityList } from "./review";
import type { personPatch } from "@/lib/dating-server";

type Patch = ReturnType<typeof personPatch>;
export async function createWithIdentity(
  userId: string,
  data: Patch & { name: string },
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const ids = data.handles ?? [];
    const identity = await resolveIdentity(tx, userId, ids);
    if (identity.personId || identity.excluded)
      throw new IntakeError(
        "These contact details already belong to a profile or excluded person. Review the existing person first.",
        409,
      );
    return tx.datingPerson.create({ data: { ...data, userId } });
  });
}
export async function updateWithIdentity(
  userId: string,
  id: string,
  data: Patch,
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const p = await tx.datingPerson.findFirst({ where: { id, userId } });
    if (!p) return null;
    if (data.handles) {
      const resolved = await resolveIdentity(tx, userId, data.handles);
      if (resolved.personId && resolved.personId !== id)
        throw new IntakeError(
          "These contact details belong to another profile",
          409,
        );
      // Explicitly changing handles updates approved identity mappings for this profile as well.
      const linked = await tx.datingCandidate.findMany({
        where: { userId, personId: id, status: "approved" },
      });
      for (const c of linked)
        await tx.datingCandidate.update({
          where: { id: c.id },
          data: {
            ...(c.identityKey.startsWith("contact:")
              ? { identityKey: `linked:${c.id}` }
              : {}),
            identities: json(
              identityList(c.identities)
                .filter((i) => !p.handles.includes(i))
                .concat(data.handles),
            ),
          },
        });
    }
    return tx.datingPerson.update({
      where: { id },
      data: { ...data, insights: Prisma.DbNull, insightsAt: null },
    });
  });
}
export async function removeWithIdentity(
  userId: string,
  id: string,
  exclude: boolean,
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const p = await tx.datingPerson.findFirst({ where: { id, userId } });
    if (!p) return false;
    if (exclude) {
      const identity = await resolveIdentity(tx, userId, p.handles);
      for (const c of identity.matches)
        await tx.datingCandidate.update({
          where: { id: c.id },
          data: { status: "excluded" },
        });
      if (p.handles.length)
        await tx.datingCandidate.upsert({
          where: {
            userId_identityKey: {
              userId,
              identityKey: `contact:${hash(p.handles[0])}`,
            },
          },
          create: {
            userId,
            identityKey: `contact:${hash(p.handles[0])}`,
            name: p.name,
            identities: json(p.handles),
            status: "excluded",
          },
          update: { status: "excluded" },
        });
      await tx.datingCandidate.updateMany({
        where: { userId, personId: id },
        data: { status: "excluded" },
      });
    }
    // Ordinary deletion lets new evidence suggest them again; "dismissed" is final.
    if (!exclude)
      await tx.datingCandidate.updateMany({
        where: { userId, personId: id, status: "approved" },
        data: { status: "pending" },
      });
    await tx.datingPerson.delete({ where: { id } });
    return true;
  });
}
