import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toEventDTO, toMessageDTO, toPersonDTO } from "@/lib/dating-server";
import { toPhotoDTO } from "@/lib/dating-photos";
import { DatingDetail } from "@/components/dating/dating-detail";

export const dynamic = "force-dynamic";

const PAGE = 200;

export default async function DatingPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const person = await prisma.datingPerson.findFirst({ where: { id, userId: session.userId } });
  if (!person) notFound();

  const [events, recent, meta, photos] = await Promise.all([
    prisma.datingEvent.findMany({ where: { personId: id }, orderBy: { occurredAt: "asc" } }),
    prisma.datingMessage.findMany({
      where: { personId: id },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      select: { id: true, fromMe: true, text: true, source: true, sentAt: true },
    }),
    prisma.datingMessage.findMany({
      where: { personId: id },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true, fromMe: true },
    }),
    prisma.datingPhoto.findMany({ where: { personId: id, userId: session.userId }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <DatingDetail
      key={person.id}
      initialPerson={toPersonDTO(person)}
      initialEvents={events.map(toEventDTO)}
      initialMessages={recent.slice(0, PAGE).reverse().map(toMessageDTO)}
      initialMore={recent.length > PAGE}
      initialPhotos={photos.map(toPhotoDTO)}
      meta={meta.map((m) => ({ sentAt: m.sentAt.toISOString(), fromMe: m.fromMe }))}
    />
  );
}
