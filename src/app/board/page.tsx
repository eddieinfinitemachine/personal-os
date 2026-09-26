import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MoodBoard } from "@/components/board/mood-board";
import { toCard } from "@/components/board/types";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const items = await prisma.boardItem.findMany({
    where: { userId: session.userId },
    orderBy: { savedAt: "desc" },
    take: 1000,
  });
  return <MoodBoard initialItems={items.map(toCard)} />;
}
