import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const expected = process.env.APP_PASSWORD ?? "456";
  if (password !== expected) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("personalos-auth", "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
