import {
  Activity,
  Beaker,
  CalendarClock,
  Dumbbell,
  Dna,
  Heart,
  HeartPulse,
  Pill,
  Stethoscope,
  Syringe,
  User,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { prisma } from "@/lib/prisma";
import { loadHealthSummary } from "@/lib/health/load";
import { labDate } from "@/lib/health/lab-value";
import type { NutritionSummary } from "@/lib/health/nutrition";
import { isPictureStale, pictureEvidence, readStoredPicture } from "@/lib/health/picture";
import type { WorkoutSource } from "@/lib/workout-history";
import { HealthPictureCard } from "./health-picture";
import { LabGrid, type LabRow } from "./lab-grid";
import { LabSection } from "./lab-section";
import type { MarkerSeries } from "./lab-trends";

const HIGHER_IS_BETTER = new Set([
  "HDL Cholesterol",
  "HDL Large",
  "LDL Peak Size",
  "Vitamin D 25-OH",
  "Free T3",
  "Free T4",
  "OmegaCheck (EPA+DPA+DHA)",
  "EPA",
  "DPA",
  "DHA",
  "% Saturation",
  "eGFR",
]);

const MARQUEE_MARKERS = [
  "ApoB",
  "LDL Particle Number",
  "HDL Cholesterol",
  "HDL Large",
  "Hemoglobin A1c",
  "HS CRP",
  "Vitamin D 25-OH",
  "TPO Antibodies",
  "Free Testosterone",
];

// Plain names for biometric kinds, in the order they appear. Any other kind shows as stored.
const BIOMETRIC_LABELS: Record<string, string> = {
  weight: "Weight",
  bodyFat: "Body fat",
  visceralFat: "Visceral fat",
  bmi: "BMI",
  rhr: "RHR",
  bpSystolic: "BP systolic",
  bpDiastolic: "BP diastolic",
  heartAge: "Heart age",
  abi: "ABI",
  anklePressure: "Ankle pressure",
  spo2: "Blood oxygen",
  ekgConductionTime: "EKG conduction",
  ekgVentricularContraction: "EKG contraction",
  ekgContractAndReset: "EKG contract + reset",
  gripRight: "Grip, right hand",
  eyePressure: "Eye pressure",
  skinMarkings: "Skin markings",
};
const BIOMETRIC_ORDER = Object.keys(BIOMETRIC_LABELS);

function biometricRank(kind: string): number {
  const rank = BIOMETRIC_ORDER.indexOf(kind);
  return rank === -1 ? BIOMETRIC_ORDER.length : rank;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ageYears(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let y = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) y--;
  return y;
}

const SOURCE_LABELS: Record<WorkoutSource, string | null> = { guided: null, board: "Whiteboard", strava: "Strava" };
const APPLE_HEALTH_SHORTCUT =
  "https://github.com/eddieinfinitemachine/personal-os/blob/main/docs/shortcuts/apple-health.md";

type Allergy = { allergen?: string; severity?: string; notes?: string };
type Medication = { name?: string; dosage?: string; frequency?: string };
type Condition = { name?: string; diagnosedAt?: string; notes?: string };

export async function HumanDashboard({ projectId }: { projectId: string }) {
  const human = await prisma.human.findUnique({
    where: { projectId },
    include: {
      // The latest of each kind, so daily readings can't crowd out a one-off.
      biometrics: { orderBy: [{ kind: "asc" }, { measuredAt: "desc" }], distinct: ["kind"] },
      // Not limited: trends need the oldest draw, and each draw is about 100 rows.
      labResults: { orderBy: { drawnAt: "desc" } },
      medicalVisits: { orderBy: { performedAt: "desc" }, take: 12 },
      vaccinations: { orderBy: { administeredAt: "desc" }, take: 12 },
      fitnessSessions: { orderBy: { performedAt: "desc" }, take: 12 },
      dnaResults: { orderBy: { reportedAt: "desc" }, take: 30 },
    },
  });

  if (!human) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        No human profile yet for this project.
      </div>
    );
  }

  const pictureNow = new Date();
  const summary = await loadHealthSummary(human, pictureNow);
  const picture = readStoredPicture(human.pictureJson);
  const hasLabs = summary.labs.markers.length > 0;

  const age = ageYears(human.birthDate ?? null);
  const allergies = (human.allergiesJson as Allergy[] | null) ?? [];
  const medications = (human.medicationsJson as Medication[] | null) ?? [];
  const conditions = (human.conditionsJson as Condition[] | null) ?? [];

  const latestWeight = human.biometrics.find((b) => b.kind === "weight");
  const latestRhr = human.biometrics.find((b) => b.kind === "rhr");
  const latestApoB = human.labResults.find((l) => l.marker === "ApoB");

  // Group labs by draw date. Each draw becomes a tab.
  const drawDates = Array.from(
    new Set(
      human.labResults.map((l) => l.drawnAt.toISOString().slice(0, 10))
    )
  ).sort();

  const labsByDraw = new Map<string, LabRow[]>();
  for (const date of drawDates) {
    labsByDraw.set(
      date,
      human.labResults
        .filter((l) => l.drawnAt.toISOString().slice(0, 10) === date)
        .map((l) => ({
          id: l.id,
          drawnAt: l.drawnAt,
          panel: l.panel,
          marker: l.marker,
          value: l.value,
          unit: l.unit,
          refLow: l.refLow,
          refHigh: l.refHigh,
          flag: l.flag,
          notes: l.notes,
        }))
    );
  }

  // Build trend series for marquee markers.
  const allByMarker = new Map<string, LabRow[]>();
  for (const l of human.labResults) {
    const arr = allByMarker.get(l.marker) ?? [];
    arr.push({
      id: l.id,
      drawnAt: l.drawnAt,
      panel: l.panel,
      marker: l.marker,
      value: l.value,
      unit: l.unit,
      refLow: l.refLow,
      refHigh: l.refHigh,
      flag: l.flag,
      notes: l.notes,
    });
    allByMarker.set(l.marker, arr);
  }
  const marqueeSeries: MarkerSeries[] = MARQUEE_MARKERS.flatMap((marker) => {
    const rows = allByMarker.get(marker);
    if (!rows || rows.length === 0) return [];
    rows.sort(
      (a, b) =>
        new Date(a.drawnAt).getTime() - new Date(b.drawnAt).getTime()
    );
    return [
      {
        marker,
        unit: rows[0].unit,
        refLow: rows[0].refLow,
        refHigh: rows[0].refHigh,
        higherIsBetter: HIGHER_IS_BETTER.has(marker),
        points: rows.map((r) => ({
          date: new Date(r.drawnAt).toISOString().slice(0, 10),
          value: r.value,
        })),
      },
    ];
  });

  // Vaccination overdue / due-soon badges.
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 60);
  const dueVax = human.vaccinations.filter(
    (v) => v.boosterDueAt && v.boosterDueAt >= now && v.boosterDueAt <= horizon
  );
  const overdueVax = human.vaccinations.filter(
    (v) => v.boosterDueAt && v.boosterDueAt < now
  );

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--color-muted-foreground)] text-xs uppercase tracking-wider">
              <User className="size-3" /> {human.sex ?? "—"}
              {age !== null ? ` · ${age}y` : ""}
              {human.bloodType ? ` · ${human.bloodType}` : ""}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight mt-1">
              {human.fullName}
            </h2>
            <div className="text-sm text-[var(--color-muted-foreground)] mt-1">
              DOB {fmtDate(human.birthDate)}
              {human.heightInches
                ? ` · ${Math.floor(human.heightInches / 12)}'${Math.round(
                    human.heightInches % 12
                  )}"`
                : ""}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 min-w-0">
            <Stat
              label="Weight"
              value={
                latestWeight ? `${latestWeight.value} ${latestWeight.unit}` : "—"
              }
              icon={<Activity className="size-3" />}
            />
            <Stat
              label="Resting HR"
              value={latestRhr ? `${latestRhr.value} bpm` : "—"}
              icon={<HeartPulse className="size-3" />}
            />
            <Stat
              label="ApoB"
              value={latestApoB ? `${latestApoB.value} mg/dL` : "—"}
              icon={<Heart className="size-3" />}
            />
          </div>
        </div>
      </section>

      {hasLabs || picture ? (
        <HealthPictureCard
          projectId={projectId}
          initial={picture}
          initialEvidence={picture ? pictureEvidence(picture, summary) : {}}
          stale={hasLabs && isPictureStale(picture, summary, pictureNow)}
        />
      ) : null}

      {/* Alerts */}
      {(overdueVax.length > 0 || dueVax.length > 0) && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="font-semibold text-amber-400 mb-2 flex items-center gap-2">
            <Syringe className="size-4" /> Health alerts
          </h3>
          <ul className="space-y-1 text-sm">
            {overdueVax.map((v) => (
              <li key={v.id} className="text-rose-500">
                {v.name} booster overdue (was due {fmtDate(v.boosterDueAt)})
              </li>
            ))}
            {dueVax.map((v) => (
              <li key={v.id} className="text-amber-400">
                {v.name} booster due {fmtDate(v.boosterDueAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Labs */}
      <LabSection
        drawDates={drawDates}
        labsByDraw={Object.fromEntries(labsByDraw)}
        marqueeSeries={marqueeSeries}
      />

      {/* Biometrics + Body comp */}
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Activity className="size-4" /> Biometrics
        </h3>
        {human.biometrics.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            None logged.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...human.biometrics]
              .sort((a, b) => biometricRank(a.kind) - biometricRank(b.kind))
              .map((b) => (
                <BioCard key={b.id} label={BIOMETRIC_LABELS[b.kind] ?? b.kind} reading={b} />
              ))}
          </div>
        )}
      </section>

      {/* Medications + Allergies + Conditions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Pill className="size-4" /> Medications & supplements
          </h3>
          {medications.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">None.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {medications.map((m, i) => (
                <li key={i}>
                  <span className="font-medium">{m.name}</span>
                  {m.dosage ? (
                    <span className="text-[var(--color-muted-foreground)]">
                      {" "}
                      · {m.dosage}
                    </span>
                  ) : null}
                  {m.frequency ? (
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {m.frequency}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Stethoscope className="size-4" /> Conditions & allergies
          </h3>
          {conditions.length === 0 && allergies.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">None.</p>
          ) : (
            <>
              {conditions.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">
                    Conditions
                  </div>
                  <ul className="space-y-1 text-sm">
                    {conditions.map((c, i) => (
                      <li key={i}>{c.name}</li>
                    ))}
                  </ul>
                </div>
              )}
              {allergies.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">
                    Allergies
                  </div>
                  <ul className="space-y-1 text-sm">
                    {allergies.map((a, i) => (
                      <li key={i}>
                        {a.allergen}
                        {a.severity ? (
                          <span className="text-[var(--color-muted-foreground)]">
                            {" "}
                            · {a.severity}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Stethoscope className="size-4" /> Care team
          </h3>
          <ul className="space-y-1.5 text-sm">
            {human.primaryCarePhysician ? (
              <li>
                <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">
                  PCP
                </span>
                <div>{human.primaryCarePhysician}</div>
                {human.pcpPhone ? (
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {human.pcpPhone}
                  </div>
                ) : null}
              </li>
            ) : null}
            {human.insurer ? (
              <li>
                <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">
                  Insurance
                </span>
                <div>{human.insurer}</div>
                {human.policyNumber ? (
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    Policy {human.policyNumber}
                  </div>
                ) : null}
              </li>
            ) : null}
            {human.emergencyContactName ? (
              <li>
                <span className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">
                  Emergency
                </span>
                <div>{human.emergencyContactName}</div>
                {human.emergencyContactPhone ? (
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {human.emergencyContactPhone}
                  </div>
                ) : null}
              </li>
            ) : null}
            {!human.primaryCarePhysician &&
            !human.insurer &&
            !human.emergencyContactName ? (
              <li className="text-[var(--color-muted-foreground)] text-xs">
                No contacts logged.
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      {/* Visits + Workouts + Nutrition */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <CalendarClock className="size-4" /> Visits
          </h3>
          {human.medicalVisits.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              None logged.
            </p>
          ) : (
            <ol className="space-y-3 relative border-l border-[var(--color-border)] ml-2 pl-4">
              {human.medicalVisits.map((v) => (
                <li key={v.id} className="relative">
                  <span className="absolute -left-[22px] top-1.5 size-2.5 rounded-full bg-[var(--color-foreground)]/40" />
                  <div className="text-sm font-medium">
                    {fmtDate(v.performedAt)} · {v.providerName}
                    {v.specialty ? (
                      <span className="text-[var(--color-muted-foreground)] font-normal">
                        {" "}
                        · {v.specialty}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm">{v.reason}</div>
                  {v.summary ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      {v.summary}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Dumbbell className="size-4" /> Workouts
            </h3>
            <Link
              href="/workout"
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Open Workout →
            </Link>
          </div>
          {summary.training.recent.length > 0 ? (
            <ul className="space-y-2">
              {summary.training.recent.map((w, i) => {
                const details = [
                  w.focus,
                  `${w.durationMin}m`,
                  SOURCE_LABELS[w.source],
                ].filter(Boolean);
                return (
                  <li key={i} className="flex items-baseline gap-2 text-sm">
                    <span className="text-xs text-[var(--color-muted-foreground)] w-20 shrink-0 tabular-nums">
                      {labDate(w.date)}
                    </span>
                    <div className="min-w-0">
                      <span className="font-medium">{w.title}</span>
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {" "}
                        · {details.join(" · ")}
                      </span>
                      {w.exercises === 0 && w.notes ? (
                        <div className="text-xs text-[var(--color-muted-foreground)]">
                          {w.notes}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : human.fitnessSessions.length > 0 ? (
            <ul className="space-y-2">
              {human.fitnessSessions.map((s) => (
                <li key={s.id} className="flex items-baseline gap-2 text-sm">
                  <span className="text-xs text-[var(--color-muted-foreground)] w-20 shrink-0 tabular-nums">
                    {fmtDate(s.performedAt)}
                  </span>
                  <span className="font-medium">{s.kind}</span>
                  {s.durationMin ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {s.durationMin}m
                    </span>
                  ) : null}
                  {s.distanceMi ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {s.distanceMi}mi
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              None logged yet.{" "}
              <Link href="/workout" className="underline hover:text-[var(--color-foreground)]">
                Plan one on the Workout tab.
              </Link>
            </p>
          )}
        </section>

        <NutritionCard nutrition={summary.nutrition} />
      </div>

      {/* Vaccinations */}
      {human.vaccinations.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Syringe className="size-4" /> Vaccinations
          </h3>
          <ul className="space-y-1 text-sm">
            {human.vaccinations.map((v) => (
              <li key={v.id} className="flex items-baseline gap-2">
                <span className="font-medium">{v.name}</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {fmtDate(v.administeredAt)}
                </span>
                {v.boosterDueAt ? (
                  <span className="text-xs text-amber-400">
                    booster {fmtDate(v.boosterDueAt)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* DNA */}
      {human.dnaResults.length > 0 ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Dna className="size-4" /> DNA
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {human.dnaResults.map((d) => (
              <div
                key={d.id}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {d.category}
                  {d.source ? ` · ${d.source}` : ""}
                </div>
                <div className="text-sm font-medium">{d.title}</div>
                <div className="text-sm">{d.finding}</div>
                {d.detail ? (
                  <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    {d.detail}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-muted-foreground)]">
          <Dna className="size-4 inline mr-1 opacity-60" /> DNA results placeholder
          — drop reports here when they come in.
        </section>
      )}

      {/* Notes */}
      {human.notes ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h3 className="font-semibold mb-2">Notes</h3>
          <SimpleMarkdown text={human.notes} />
        </section>
      ) : null}
    </div>
  );
}

function NutritionCard({ nutrition }: { nutrition: NutritionSummary }) {
  const week = nutrition.averages.last7;
  const amount = (value: number | null, unit: string) =>
    value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: unit === "kcal" ? 0 : 1 })} ${unit}`;
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <Utensils className="size-4" /> Nutrition
      </h3>
      {nutrition.daysLogged > 0 ? (
        <>
          <div className="text-xs text-[var(--color-muted-foreground)] mb-2">
            Last 7 days · {week.days} logged
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Calories" value={amount(week.caloriesKcal, "kcal")} />
            <Stat label="Protein" value={amount(week.proteinG, "g")} />
            <Stat label="Fiber" value={amount(week.fiberG, "g")} />
            <Stat label="Saturated fat" value={amount(week.saturatedFatG, "g")} />
          </div>
          {week.proteinGPerLb !== null ? (
            <p className="text-sm mt-3">
              <span className="font-semibold tabular-nums">{week.proteinGPerLb} g</span> protein per lb of body weight
            </p>
          ) : null}
          <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
            {nutrition.app ? `From ${nutrition.app} via Apple Health` : "From Apple Health"}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--color-muted-foreground)]">Nothing from Apple Health yet.</p>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
            <a
              href={APPLE_HEALTH_SHORTCUT}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-[var(--color-foreground)]"
            >
              A daily Shortcut can send your food app&apos;s log here.
            </a>
          </p>
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-3 py-2 min-w-[80px]">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function BioCard({
  label,
  reading,
}: {
  label: string;
  reading: { value: number; unit: string; measuredAt: Date };
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">
        {reading.value} <span className="text-xs font-normal">{reading.unit}</span>
      </div>
      <div className="text-[11px] text-[var(--color-muted-foreground)]">
        {fmtDate(reading.measuredAt)}
      </div>
    </div>
  );
}
