import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { datingCards } from "@/lib/dating-cards";
import { DatingHome, type GranolaSuggestion } from "@/components/dating/dating-home";

export const dynamic = "force-dynamic";

export default async function DatingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const [cards, pending] = await Promise.all([
    datingCards(userId),
    prisma.datingSuggestion.findMany({
      where: { userId, status: "pending", sourceRecordId: null },
      orderBy: { occurredAt: "desc" },
      select: { id: true, name: true, summary: true, title: true, url: true, occurredAt: true },
    }),
  ]);
  const suggestions: GranolaSuggestion[] = pending.map((s) => ({ ...s, occurredAt: s.occurredAt.toISOString() }));

  return <DatingHome people={cards} suggestions={suggestions} />;
}
