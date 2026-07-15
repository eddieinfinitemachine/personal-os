import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Baby, Cake, FileText, Hospital, MapPin, User, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivateHost } from "@/lib/hosts";
import { getPersonalRecord } from "@/lib/personal-record";
import { AstrologyTile } from "@/components/astrology-tile";

export const dynamic = "force-dynamic";

function fmt(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function age(dob: string): string {
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
  const days = Math.floor((now.getTime() - birth.getTime()) / 86400000);
  return `${years} years · ${days.toLocaleString()} days`;
}

export default async function PersonalPage() {
  // Defense in depth: the page exists only on the private host. On the public
  // multi-tenant EC, /personal 404s before any DB lookup.
  const h = await headers();
  if (!isPrivateHost(h.get("host"))) notFound();

  const session = await getSession();
  if (!session) redirect("/login");

  const record = await getPersonalRecord(prisma, session.userId);
  if (!record) {
    return (
      <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-5xl">
        <header className="mb-6">
          <h1 className="text-large-title font-bold">Personal</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            You. The official record.
          </p>
        </header>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-sm text-[var(--color-muted-foreground)]">
          No personal record on file for this account.
        </div>
      </div>
    );
  }

  const { fullName, birth, parents, documents } = record;
  const passportDays = Math.floor(
    (new Date(documents.passport.expires).getTime() - Date.now()) / 86400000,
  );

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-large-title font-bold">Personal</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          You. The official record.
        </p>
      </header>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <User className="size-4" /> Identity
          </h3>
          <div className="space-y-1.5 text-sm">
            <Row label="Full name" value={fullName} />
            <Row label="Sex" value={birth.sex} />
            <Row label="Born" value={`${fmt(birth.date)} · ${birth.time} ${birth.hourMarker}`} />
            <Row label="Age" value={age(birth.date)} />
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Hospital className="size-4" /> Birthplace
          </h3>
          <div className="space-y-1.5 text-sm">
            <Row label="Hospital" value={birth.hospital} />
            <Row label="Borough" value={birth.borough} />
            <Row label="City" value={birth.city} />
            <Row label="Attendant" value={birth.attendant} />
            <Row label="Birth #" value={birth.birthNumber} />
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 lg:col-span-2">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Users className="size-4" /> Parents
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1.5">
                Mother
              </div>
              <div className="space-y-1.5 text-sm">
                <Row label="Name" value={parents.mother.name} />
                <Row label="DOB" value={`${fmt(parents.mother.dob)} (${age(parents.mother.dob).split(" ·")[0]})`} />
                <Row label="From" value={parents.mother.birthplace} />
                {parents.mother.residenceAtBirth ? (
                  <Row label="Childhood home" value={parents.mother.residenceAtBirth} />
                ) : null}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1.5">
                Father
              </div>
              <div className="space-y-1.5 text-sm">
                <Row label="Name" value={parents.father.name} />
                <Row label="DOB" value={`${fmt(parents.father.dob)} (${age(parents.father.dob).split(" ·")[0]})`} />
                <Row label="From" value={parents.father.birthplace} />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="size-4" /> Passport
          </h3>
          <div className="space-y-1.5 text-sm">
            <Row label="Number" value={documents.passport.number} />
            <Row label="Issued" value={fmt(documents.passport.issued)} />
            <Row
              label="Expires"
              value={
                <span
                  className={
                    passportDays < 180
                      ? "text-rose-500 font-medium"
                      : passportDays < 365
                        ? "text-amber-500"
                        : ""
                  }
                >
                  {fmt(documents.passport.expires)} · {passportDays.toLocaleString()} days
                </span>
              }
            />
            <Row label="Authority" value={documents.passport.authority} />
          </div>
        </section>

        <AstrologyTile />

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 lg:col-span-2">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Cake className="size-4" /> Fun facts
          </h3>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Fact icon={<Baby className="size-3.5" />} label="Born at" value={`${birth.time} ${birth.hourMarker}`} />
            <Fact
              icon={<MapPin className="size-3.5" />}
              label="On"
              value={new Date(birth.date).toLocaleDateString(undefined, { weekday: "long" })}
            />
            <Fact
              icon={<Cake className="size-3.5" />}
              label="Days alive"
              value={Math.floor(
                (Date.now() - new Date(birth.date).getTime()) / 86400000,
              ).toLocaleString()}
            />
            <Fact
              label="Hours alive"
              value={Math.floor(
                (Date.now() - new Date(birth.date).getTime()) / 3600000,
              ).toLocaleString()}
            />
            <Fact
              label="Heartbeats (≈)"
              value={Math.floor(
                ((Date.now() - new Date(birth.date).getTime()) / 60000) * 70,
              ).toLocaleString()}
            />
            <Fact
              label="Next birthday"
              value={(() => {
                const now = new Date();
                const birthDate = new Date(birth.date);
                const next = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate());
                if (next < now) next.setFullYear(now.getFullYear() + 1);
                const days = Math.ceil((next.getTime() - now.getTime()) / 86400000);
                return `${days} days`;
              })()}
            />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] w-32 shrink-0">
        {label}
      </div>
      <div className="flex-1">{value}</div>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-[var(--color-border)] px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
    </li>
  );
}
