import { NextResponse } from "next/server";
import { connector } from "@/lib/dating-intake/auth";
import { stateDTO } from "@/lib/dating-intake/store";
import { failure } from "@/lib/dating-intake/http";
export async function GET(request: Request) {
  try {
    return NextResponse.json(stateDTO(await connector(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
