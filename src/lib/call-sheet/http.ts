import { NextResponse } from "next/server";
import { IntakeError } from "@/lib/dating-intake/contracts";
const headers = { "Cache-Control": "private, no-store" };
export function callSheetFailure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof IntakeError
          ? error.message
          : "Could not complete this action. Try again.",
    },
    { status: error instanceof IntakeError ? error.status : 500, headers },
  );
}
