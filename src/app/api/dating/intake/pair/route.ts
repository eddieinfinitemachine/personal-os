import { NextResponse } from "next/server";
import { claimPairing, throttlePairing } from "@/lib/dating-intake/auth";
import { readJSON, object } from "@/lib/dating-intake/contracts";
import { failure } from "@/lib/dating-intake/http";
export async function POST(request: Request) {
  try {
    throttlePairing(request);
    const b = object(await readJSON(request, 1024));
    return NextResponse.json(await claimPairing(b.code, b.scope), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
