import { getThumbnail } from "@/lib/dropbox";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const link = url.searchParams.get("link");
  const size = url.searchParams.get("size") ?? "w256h256";

  if (!path && !link) {
    return new Response("path or link required", { status: 400 });
  }

  try {
    const { buffer, contentType } = await getThumbnail(
      path ? { tag: "path", path } : { tag: "link", url: link! },
      size
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "thumbnail failed";
    return new Response(message, { status: 500 });
  }
}
