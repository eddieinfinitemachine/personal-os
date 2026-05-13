import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    icon?: string;
    color?: string;
    archived?: boolean;
    position?: number;
  };

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.icon !== undefined && { icon: body.icon }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.archived !== undefined && { archived: body.archived }),
      ...(body.position !== undefined && { position: body.position }),
    },
  });
  revalidateTag("sidebar-projects", "max");
  return NextResponse.json({ project });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.project.delete({ where: { id } });
  revalidateTag("sidebar-projects", "max");
  return NextResponse.json({ ok: true });
}
