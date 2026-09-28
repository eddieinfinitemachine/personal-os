import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  actOnContactLookup,
  getContactLookup,
} from "@/lib/dating-contact-lookup";
import { readJSON } from "@/lib/dating-intake/contracts";
import { failure } from "@/lib/dating-intake/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const userId = await getCurrentUserId(request);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await getContactLookup(userId, (await params).id),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  const userId = await getCurrentUserId(request);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await actOnContactLookup(
        userId,
        (await params).id,
        await readJSON(request, 4096),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
