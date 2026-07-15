import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Build identity, used by the client to detect that a new deploy shipped
// while a long-lived window (installed PWA) is still running old JS.
export async function GET() {
  return NextResponse.json({
    version:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_DEPLOYMENT_ID ??
      "dev",
  });
}
