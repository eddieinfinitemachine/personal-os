import { NextResponse } from "next/server";
import { IntakeError } from "./contracts";
export function failure(e: unknown) {
  if (e instanceof IntakeError)
    return NextResponse.json(
      { error: e.message },
      { status: e.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error("Dating intake request failed");
  return NextResponse.json(
    { error: "Could not complete this action. Try again." },
    { status: 500 },
  );
}
