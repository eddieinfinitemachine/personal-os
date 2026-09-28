import { after, NextResponse } from "next/server";
import { connector } from "@/lib/dating-intake/auth";
import { readJSON } from "@/lib/dating-intake/contracts";
import { acceptRecord } from "@/lib/dating-intake/store";
import { processSource } from "@/lib/dating-intake/extract";
import { failure } from "@/lib/dating-intake/http";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const s = await connector(request);
    const result = await acceptRecord(
      s.userId,
      s.id,
      await readJSON(request),
      s.tokenHash!,
    );
    if (result.complete)
      after(async () => {
        try {
          await processSource(s.userId, s.id);
        } catch {
          console.error("Dating intake processing failed");
        }
      });
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
