import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { deleteAssetWithBlobs } from "@/lib/asset-delete";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { ids, action, data: input } = body as Record<string, unknown>;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 200 ||
    !ids.every((id): id is string => typeof id === "string")
  ) {
    return NextResponse.json({ error: "ids must contain 1 to 200 strings" }, { status: 400 });
  }
  if (action !== "update" && action !== "delete") {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const data: { status?: string | null; category?: string | null; location?: string | null } = {};
  if (action === "update") {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ error: "update data required" }, { status: 400 });
    }
    const values = input as Record<string, unknown>;
    for (const key of ["status", "category", "location"] as const) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      const value = values[key];
      if (value !== null && typeof value !== "string") {
        return NextResponse.json({ error: `${key} must be a string or null` }, { status: 400 });
      }
      data[key] = value;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "at least one update field required" }, { status: 400 });
    }
  }

  const assets = await prisma.asset.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  });
  const ownedIds = assets.map((asset) => asset.id);
  if (action === "update") {
    const { count } = await prisma.asset.updateMany({
      where: { id: { in: ownedIds }, userId },
      data,
    });
    return NextResponse.json({ ok: true, count });
  }

  for (const id of ownedIds) {
    await deleteAssetWithBlobs(id);
  }
  return NextResponse.json({ ok: true, count: ownedIds.length });
}
