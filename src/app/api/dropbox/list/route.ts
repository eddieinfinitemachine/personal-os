import { NextResponse } from "next/server";
import { isDropboxFolderUrl, listFolderByPath, listSharedFolder } from "@/lib/dropbox";

export async function POST(request: Request) {
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
