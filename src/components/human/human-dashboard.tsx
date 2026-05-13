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
} from "lucide-react";
import { prisma } from "@/lib/prisma";
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

type Allergy = { allergen?: string; severity?: string; notes?: string };
type Medication = { name?: string; dosage?: string; frequency?: string };
type Condition = { name?: string; diagnosedAt?: string; notes?: string };

export async function HumanDashboard({ projectId }: { projectId: string }) {
  const human = await prisma.human.findUnique({
    where: { projectId },
    include: {
      biometrics: { orderBy: { measuredAt: "desc" }, take: 30 },
      labResults: { orderBy: { drawnAt: "desc" }, take: 100 },
      medicalVisits: { orderBy: { performedAt: "desc" }, take: 12 },
      vaccinations: { orderBy: { administeredAt: "desc" }, take: 12 },
      fitnessSessions: { orderBy: { performedAt: "desc" }, take: 12 },
      dnaResults: { orderBy: { reportedAt: "desc" }, take: 30 },
    },
  });

  if (!human) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        No human profile yet for this project. Hit{" "}
        <code className="text-xs">POST /api/admin/seed-health</code> to seed
        from cardio-coach.
      </div>
    );
  }

  const age = ageYears(human.birthDate ?? null);
  const allergies = (human.allergiesJson as Allergy[] | null) ?? [];
  const medications = (human.medicationsJson as Medication[] | null) ?? [];
  const conditions = (human.conditionsJson as Condition[] | null) ?? [];

  const latestWeight = human.biometrics.find((b) => b.kind === "weight");
  const latestRhr = human.biometrics.find((b) => b.kind === "rhr");
  const latestBodyFat = human.biometrics.find((b) => b.kind === "bodyFat");
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
              <User className="size-3" /> Human · {human.sex ?? "—"}
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
            {latestWeight && (
              <BioCard label="Weight" reading={latestWeight} />
            )}
            {latestBodyFat && (
              <BioCard label="Body fat" reading={latestBodyFat} />
            )}
            {latestRhr && <BioCard label="RHR" reading={latestRhr} />}
            {human.biometrics
              .filter(
                (b) =>
                  b.kind !== "weight" &&
                  b.kind !== "bodyFat" &&
                  b.kind !== "rhr"
              )
              .slice(0, 4)
              .map((b) => (
                <BioCard key={b.id} label={b.kind} reading={b} />
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

      {/* Visits + Fitness */}
      <div className="grid gap-4 lg:grid-cols-2">
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
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Dumbbell className="size-4" /> Fitness sessions
          </h3>
          {human.fitnessSessions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              None logged yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {human.fitnessSessions.map((s) => (
                <li key={s.id} className="flex items-baseline gap-2 text-sm">
                  <span className="text-xs text-[var(--color-muted-foreground)] w-16 shrink-0 tabular-nums">
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
          )}
        </section>
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
          <div className="text-sm whitespace-pre-wrap">{human.notes}</div>
        </section>
      ) : null}
    </div>
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
