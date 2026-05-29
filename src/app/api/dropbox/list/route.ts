import { NextResponse } from "next/server";
import { isDropboxFolderUrl, listFolderByPath, listSharedFolder } from "@/lib/dropbox";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";

export async function POST(request: Request) {
  // Dropbox access uses a single shared service token with full root-namespace
  // reach — gate it to the founder so other tenants can't enumerate it.
  const userId = await getCurrentUserId(request);
  if (!(await isFounderUser(userId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json()) as { url?: string; path?: string };

  try {
    if (body.url) {
      if (!isDropboxFolderUrl(body.url)) {
        return NextResponse.json(
          { error: "not a Dropbox folder URL" },
          { status: 400 }
        );
      }
      const entries = await listSharedFolder(body.url, false);
      return NextResponse.json({ entries });
    }
    if (body.path) {
      const entries = await listFolderByPath(body.path, false);
      return NextResponse.json({ entries });
    }
    return NextResponse.json({ error: "url or path required" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "list failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
