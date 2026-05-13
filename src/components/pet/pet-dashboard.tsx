import {
  AlertTriangle,
  CalendarClock,
  Cat,
  Check,
  Dog,
  Heart,
  PawPrint,
  Phone,
  Scale,
  Syringe,
  Utensils,
} from "lucide-react";

function speciesIcon(species: string) {
  if (species === "cat") return Cat;
  if (species === "dog") return Dog;
  return PawPrint;
}
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { PhotoGallery } from "../photo-gallery";
import { AddWeight } from "./add-weight";
import { AddVaccination } from "./add-vaccination";
import { AddVetVisit } from "./add-vet-visit";
import { LifeStagePanel } from "./life-stage-panel";
import { BreedQA } from "./breed-qa";
import { CoachingPanel } from "../coaching-panel";
import { HeroWeightEditor } from "./hero-weight-editor";

type DueStatus = "overdue" | "due-soon" | "ok" | "unknown";

const DUE_SOON_DAYS = 30;

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ageFrom(dob: Date | string, now = new Date()): string {
  const d = new Date(dob);
  const ms = now.getTime() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 14) return `${days}d old`;
  if (days < 90) return `${Math.floor(days / 7)}w old`;
  const months =
    (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 24) return `${months}mo old`;
  const years = months / 12;
  return `${years.toFixed(1)}y old`;
}

function daysFromNow(date: Date | string, today = new Date()): number {
  return Math.floor(
    (new Date(date).getTime() - today.getTime()) / 86_400_000
  );
}

function vaccinationStatus(
  boosterDueAt: Date | string | null
): { status: DueStatus; daysFromNow: number | null } {
  if (!boosterDueAt) return { status: "unknown", daysFromNow: null };
  const days = daysFromNow(boosterDueAt);
  if (days < 0) return { status: "overdue", daysFromNow: days };
  if (days <= DUE_SOON_DAYS) return { status: "due-soon", daysFromNow: days };
  return { status: "ok", daysFromNow: days };
}

function statusColor(status: DueStatus) {
  switch (status) {
    case "overdue":
      return { bg: "bg-rose-500/10", text: "text-rose-500", ring: "ring-rose-500/30" };
    case "due-soon":
      return { bg: "bg-amber-500/10", text: "text-amber-500", ring: "ring-amber-500/30" };
    case "ok":
      return { bg: "bg-emerald-500/10", text: "text-emerald-500", ring: "ring-emerald-500/30" };
    case "unknown":
      return { bg: "bg-zinc-500/10", text: "text-zinc-400", ring: "ring-zinc-500/20" };
  }
}

function formatRelDays(days: number): string {
  if (days === 0) return "today";
  if (days > 0) {
    if (days < 30) return `in ${days}d`;
    if (days < 365) return `in ${Math.round(days / 30)}mo`;
    return `in ${(days / 365).toFixed(1)}y`;
  }
  const past = Math.abs(days);
  if (past < 30) return `${past}d overdue`;
  if (past < 365) return `${Math.round(past / 30)}mo overdue`;
  return `${(past / 365).toFixed(1)}y overdue`;
}

export async function PetDashboard({ projectId }: { projectId: string }) {
  const pet = await prisma.pet.findUnique({
    where: { projectId },
    include: {
      weights: { orderBy: { measuredAt: "desc" } },
      vaccinations: { orderBy: { administeredAt: "desc" } },
      vetVisits: { orderBy: { performedAt: "desc" } },
      photos: { orderBy: { position: "asc" } },
      shoppingItems: {
        orderBy: [{ completedAt: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      },
      recommendations: {
        where: { completedAt: null, dismissedAt: null },
        orderBy: { position: "asc" },
      },
    },
  });

  if (!pet) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-12 text-center">
        <PawPrint className="size-8 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No pet attached to this project.
        </p>
      </div>
    );
  }

  const SpeciesIcon = speciesIcon(pet.species);

  const latestWeight = pet.weights[0];
  const previousWeight = pet.weights[1];
  const weightDelta =
    latestWeight && previousWeight
      ? latestWeight.weightLb - previousWeight.weightLb
      : null;

  const vaxAlerts = pet.vaccinations
    .map((v) => ({ vax: v, due: vaccinationStatus(v.boosterDueAt) }))
    .filter(({ due }) => due.status === "overdue" || due.status === "due-soon");

  const sexLabel =
    pet.sex === "F"
      ? pet.spayedNeuteredAt
        ? "Female / spayed"
        : "Female"
      : pet.sex === "M"
        ? pet.spayedNeuteredAt
          ? "Male / neutered"
          : "Male"
        : null;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 flex flex-col lg:flex-row lg:items-center gap-6 justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide mb-1">
            <SpeciesIcon className="size-3.5" />
            <span>{pet.species}{pet.breed ? ` · ${pet.breed}` : ""}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">{pet.name}</h2>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {pet.birthDate ? `${ageFrom(pet.birthDate)} · born ${formatDate(pet.birthDate)}` : ""}
            {sexLabel ? ` · ${sexLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-col gap-1 lg:items-end">
          <div className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide">
            Current weight
          </div>
          <HeroWeightEditor
            petId={pet.id}
            currentWeightLb={latestWeight ? latestWeight.weightLb : null}
            delta={weightDelta}
          />
          {latestWeight ? (
            <div className="text-xs text-[var(--color-muted-foreground)]">
              measured {formatDate(latestWeight.measuredAt)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Alerts */}
      {vaxAlerts.length > 0 ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="size-4 text-rose-500" />
            <h3 className="font-semibold text-rose-500">
              {vaxAlerts.length} vaccination {vaxAlerts.length === 1 ? "booster" : "boosters"} need attention
            </h3>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {vaxAlerts.map(({ vax, due }) => {
              const c = statusColor(due.status);
              return (
                <li key={vax.id} className={cn("rounded-lg p-3", c.bg)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-sm">{vax.name}</span>
                    <span className={cn("text-xs tabular-nums", c.text)}>
                      {due.daysFromNow !== null ? formatRelDays(due.daysFromNow) : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <CoachingPanel
        generateUrl={`/api/pets/${pet.id}/coach`}
        initialRecommendations={pet.recommendations}
      />

      <LifeStagePanel
        petId={pet.id}
        initialNote={pet.lifeStageNote}
        initialNoteAt={pet.lifeStageNoteAt}
      />

      <PhotoGallery apiBase={`/api/pets/${pet.id}`} photos={pet.photos} />

      {/* Weight + Feeding */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Scale className="size-4" /> Weight history
            </h3>
            <AddWeight petId={pet.id} />
          </div>
          {pet.weights.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No weights logged yet.</p>
          ) : (
            <>
              <WeightSparkline weights={pet.weights} />
              <ol className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                {pet.weights.map((w, i) => {
                  const prev = pet.weights[i + 1];
                  const delta = prev ? w.weightLb - prev.weightLb : null;
                  return (
                    <li
                      key={w.id}
                      className="flex items-baseline justify-between gap-2 text-sm"
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="tabular-nums font-medium">
                          {w.weightLb.toFixed(1)} lb
                        </span>
                        {delta !== null ? (
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              delta > 0 ? "text-emerald-500" : delta < 0 ? "text-rose-500" : "text-[var(--color-muted-foreground)]"
                            )}
                          >
                            {delta > 0 ? "+" : ""}
                            {delta.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                        {formatDate(w.measuredAt)}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Utensils className="size-4" /> Feeding
          </h3>
          {pet.feedingSchedule ? (
            <p className="text-sm leading-relaxed">{pet.feedingSchedule}</p>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No feeding schedule yet.
            </p>
          )}
        </section>
      </div>

      {/* Vaccinations */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Syringe className="size-4" /> Vaccinations
          </h3>
          <AddVaccination petId={pet.id} />
        </div>
        {pet.vaccinations.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No vaccinations recorded yet.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pet.vaccinations.map((v) => {
              const due = vaccinationStatus(v.boosterDueAt);
              const c = statusColor(due.status);
              return (
                <li
                  key={v.id}
                  className={cn(
                    "rounded-2xl border border-[var(--color-border)] p-4 flex flex-col gap-2 ring-1",
                    c.ring
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-sm leading-snug">{v.name}</div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        c.bg,
                        c.text
                      )}
                    >
                      {due.status === "ok" ? <Check className="size-2.5" /> : null}
                      {due.status === "overdue"
                        ? "Overdue"
                        : due.status === "due-soon"
                          ? "Due soon"
                          : due.status === "ok"
                            ? "OK"
                            : "—"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-[var(--color-muted-foreground)]">Given</div>
                      <div className="tabular-nums">{formatDate(v.administeredAt)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--color-muted-foreground)]">Booster</div>
                      <div className={cn("tabular-nums", c.text)}>
                        {v.boosterDueAt
                          ? `${formatDate(v.boosterDueAt)}${
                              due.daysFromNow !== null ? ` (${formatRelDays(due.daysFromNow)})` : ""
                            }`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  {v.notes ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] leading-snug mt-1">
                      {v.notes}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Vet visits */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <CalendarClock className="size-4" /> Vet visits
          </h3>
          <AddVetVisit petId={pet.id} />
        </div>
        {pet.vetVisits.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No visits yet.</p>
        ) : (
          <ol className="space-y-3 relative border-l border-[var(--color-border)] ml-2 pl-4">
            {pet.vetVisits.map((v) => (
              <li key={v.id} className="relative">
                <span className="absolute -left-[22px] top-1.5 size-2.5 rounded-full bg-[var(--color-foreground)]/40" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium text-sm">
                    {formatDate(v.performedAt)}
                    <span className="text-[var(--color-muted-foreground)] font-normal ml-2">
                      {v.reason}
                    </span>
                  </div>
                  {v.costUsd != null ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                      ${v.costUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  ) : null}
                </div>
                {v.vet ? (
                  <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    {v.vet}
                  </div>
                ) : null}
                {v.details ? <div className="text-sm mt-1">{v.details}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Identity + vet contact */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Heart className="size-4" /> Identity
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Field label="Species" value={pet.species} />
            <Field label="Breed" value={pet.breed} />
            <Field label="Sex" value={sexLabel} />
            <Field label="Color" value={pet.color} />
            <Field label="Date of birth" value={pet.birthDate ? formatDate(pet.birthDate) : null} />
            <Field
              label="Spayed / neutered"
              value={pet.spayedNeuteredAt ? formatDate(pet.spayedNeuteredAt) : null}
            />
            <Field label="Microchip" value={pet.microchipId} mono />
          </dl>
        </section>

        {pet.vetClinic || pet.vetPhone ? (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <h3 className="font-semibold mb-3">Vet contact</h3>
            <dl className="text-sm space-y-1">
              <Field label="Clinic" value={pet.vetClinic} />
              <Field label="Address" value={pet.vetAddress} />
              {pet.vetPhone ? (
                <div className="pt-1">
                  <a
                    href={`tel:${pet.vetPhone.replace(/\s+/g, "")}`}
                    className="inline-flex items-center gap-1.5 text-sm hover:underline"
                  >
                    <Phone className="size-3.5" /> {pet.vetPhone}
                  </a>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
      </div>

      <BreedQA petId={pet.id} petName={pet.name} breed={pet.breed} />

      {pet.notes ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3">Notes</h3>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-[var(--color-foreground)]/90">
            {pet.notes}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function WeightSparkline({
  weights,
}: {
  weights: { measuredAt: Date | string; weightLb: number }[];
}) {
  if (weights.length < 2) return null;
  const sorted = [...weights].sort(
    (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime()
  );
  const min = Math.min(...sorted.map((w) => w.weightLb));
  const max = Math.max(...sorted.map((w) => w.weightLb));
  const range = Math.max(max - min, 0.1);
  const W = 600;
  const H = 80;
  const padX = 8;
  const padY = 8;
  const tFirst = new Date(sorted[0].measuredAt).getTime();
  const tLast = new Date(sorted[sorted.length - 1].measuredAt).getTime();
  const tRange = Math.max(tLast - tFirst, 1);

  const points = sorted.map((w) => {
    const x =
      padX +
      ((new Date(w.measuredAt).getTime() - tFirst) / tRange) * (W - padX * 2);
    const y = H - padY - ((w.weightLb - min) / range) * (H - padY * 2);
    return { x, y, w };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-20 overflow-visible"
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-rose-500"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          className="fill-rose-500"
        />
      ))}
    </svg>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className={cn("text-sm", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  );
}
