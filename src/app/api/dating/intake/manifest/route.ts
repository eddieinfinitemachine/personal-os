import { NextResponse } from "next/server";
import { connector } from "@/lib/dating-intake/auth";
import { readJSON } from "@/lib/dating-intake/contracts";
import { acceptManifest } from "@/lib/dating-intake/store";
import { failure } from "@/lib/dating-intake/http";
export async function POST(request: Request) {
  try {
    const s = await connector(request);
    return NextResponse.json(
      await acceptManifest(
        s.userId,
        s.id,
        await readJSON(request, 2 * 1024 * 1024),
        s.tokenHash!,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
