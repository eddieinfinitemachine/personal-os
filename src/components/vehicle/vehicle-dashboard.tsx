import {
  CalendarClock,
  Car,
  Check,
  Mail,
  Phone,
  Shield,
  Wrench,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  computeDue,
  formatRelativeDays,
  formatRelativeMiles,
  statusColor,
  type DueStatus,
} from "@/lib/maintenance";
import { cn } from "@/lib/utils";
import { MileageEditor } from "./mileage-editor";
import { ServicingSummary } from "./servicing-summary";
import { AddServiceRecord } from "./add-service-record";
import { LogDrive } from "./log-drive";
import { PhotoGallery } from "../photo-gallery";
import { ShoppingList } from "../shopping-list";
import { CoachingPanel } from "../coaching-panel";

type LabeledValue = { label?: string; value?: string };
type FluidSpec = { system?: string; spec?: string; capacity?: string };
type PartNumber = { name?: string; number?: string };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export async function VehicleDashboard({ projectId }: { projectId: string }) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { projectId },
    include: {
      serviceItems: { orderBy: { position: "asc" } },
      serviceRecords: { orderBy: { performedAt: "desc" } },
      contacts: { orderBy: { position: "asc" } },
      photos: { orderBy: { position: "asc" } },
      shoppingItems: {
        orderBy: [{ completedAt: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      },
      recommendations: {
        where: { completedAt: null, dismissedAt: null },
        orderBy: { position: "asc" },
      },
      drives: { orderBy: { drivenAt: "desc" }, take: 20 },
    },
  });

  if (!vehicle) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-12 text-center">
        <Car className="size-8 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No vehicle attached to this project.
        </p>
      </div>
    );
  }

  // Compute status for every service item (used by the maintenance grid).
  const itemsWithStatus = vehicle.serviceItems.map((item) => ({
    item,
    due: computeDue(item, vehicle.currentMileage),
  }));

  const fluids = asArray<FluidSpec>(vehicle.fluidSpecs);
  const parts = asArray<PartNumber>(vehicle.partNumbers);
  const performance = asArray<LabeledValue>(vehicle.performanceSpecs);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 flex flex-col lg:flex-row lg:items-center gap-6 justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide mb-1">
            <Car className="size-3.5" />
            <span>{vehicle.year} {vehicle.make}</span>
            {vehicle.chassisNumber ? (
              <>
                <span>·</span>
                <span className="tabular-nums">Chassis {vehicle.chassisNumber}</span>
              </>
            ) : null}
          </div>
          <h2 className="text-3xl font-bold tracking-tight">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h2>
          {vehicle.exteriorColor || vehicle.interiorColor ? (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {vehicle.exteriorColor}
              {vehicle.exteriorColor && vehicle.interiorColor ? " · " : ""}
              {vehicle.interiorColor}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="text-xs text-[var(--color-muted-foreground)] uppercase tracking-wide">
            Current odometer
          </div>
          <MileageEditor
            vehicleId={vehicle.id}
            currentMileage={vehicle.currentMileage}
            unit={vehicle.mileageUnit}
          />
          {vehicle.acquiredAt ? (
            <div className="text-xs text-[var(--color-muted-foreground)]">
              Acquired {formatDate(vehicle.acquiredAt)}
              {vehicle.acquiredMileage != null
                ? ` at ${vehicle.acquiredMileage.toLocaleString()} ${vehicle.mileageUnit}`
                : ""}
            </div>
          ) : null}
        </div>
      </div>

      {/* Servicing — update odometer & see what's due by distance */}
      <ServicingSummary
        variant="full"
        vehicleId={vehicle.id}
        vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        unit={vehicle.mileageUnit}
        currentMileage={vehicle.currentMileage}
        items={vehicle.serviceItems.map((i) => ({
          id: i.id,
          name: i.name,
          intervalMonths: i.intervalMonths,
          intervalMileage: i.intervalMileage,
          lastPerformedAt: i.lastPerformedAt ? i.lastPerformedAt.toISOString() : null,
          lastPerformedMileage: i.lastPerformedMileage,
        }))}
      />

      <CoachingPanel
        generateUrl={`/api/vehicles/${vehicle.id}/coach`}
        initialRecommendations={vehicle.recommendations}
      />

      <PhotoGallery apiBase={`/api/vehicles/${vehicle.id}`} photos={vehicle.photos} />

      <LogDrive
        vehicleId={vehicle.id}
        unit={vehicle.mileageUnit}
        drives={vehicle.drives.map((d) => ({
          id: d.id,
          drivenAt: d.drivenAt.toISOString(),
          distance: d.distance,
          destination: d.destination,
          notes: d.notes,
        }))}
      />

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="size-4" /> Maintenance schedule
        </h3>
        <AddServiceRecord
          vehicleId={vehicle.id}
          items={vehicle.serviceItems.map((i) => ({ id: i.id, name: i.name }))}
        />
      </div>

      {/* Maintenance grid */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {itemsWithStatus.map(({ item, due }) => (
          <MaintenanceCard
            key={item.id}
            name={item.name}
            intervalLabel={intervalLabel(item.intervalMonths, item.intervalMileage, vehicle.mileageUnit)}
            lastPerformedAt={item.lastPerformedAt}
            lastPerformedMileage={item.lastPerformedMileage}
            mileageUnit={vehicle.mileageUnit}
            notes={item.notes}
            due={due}
          />
        ))}
      </ul>

      {/* Service history + Shopping list */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <CalendarClock className="size-4" /> Service history
          </h3>
          {vehicle.serviceRecords.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No records yet.</p>
          ) : (
            <ol className="space-y-3 relative border-l border-[var(--color-border)] ml-2 pl-4">
              {vehicle.serviceRecords.map((r) => (
                <li key={r.id} className="relative">
                  <span className="absolute -left-[22px] top-1.5 size-2.5 rounded-full bg-[var(--color-foreground)]/40" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium text-sm">
                      {formatDate(r.performedAt)}
                      {r.mileage != null ? (
                        <span className="text-[var(--color-muted-foreground)] tabular-nums ml-2 font-normal">
                          {r.mileage.toLocaleString()} {vehicle.mileageUnit}
                        </span>
                      ) : null}
                    </div>
                    {r.costUsd != null ? (
                      <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                        ${r.costUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    ) : null}
                  </div>
                  {r.shop ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      {r.shop}
                    </div>
                  ) : null}
                  <div className="text-sm mt-1">{r.workSummary}</div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <ShoppingList apiBase={`/api/vehicles/${vehicle.id}`} items={vehicle.shoppingItems} />
      </div>

      {/* Specifications + Identity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {performance.length > 0 ? (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <h3 className="font-semibold mb-3">Specifications</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {performance.map((p, i) => (
                <div key={i} className="flex flex-col">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">
                    {p.label}
                  </dt>
                  <dd>{p.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3">Identity</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Field label="VIN" value={vehicle.vin} mono />
            <Field label="Chassis" value={vehicle.chassisNumber} mono />
            <Field label="Engine #" value={vehicle.engineNumber} mono />
            <Field label="Assembly #" value={vehicle.assemblyNumber} mono />
            <Field label="Body" value={vehicle.bodyStyle} />
            <Field label="Market" value={vehicle.marketSpec} />
            <Field label="Transmission" value={vehicle.transmission} />
            {vehicle.acquiredFrom ? (
              <Field label="Sold by" value={vehicle.acquiredFrom} />
            ) : null}
          </dl>
        </section>
      </div>

      {/* Fluids + parts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {fluids.length > 0 ? (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <h3 className="font-semibold mb-3">Fluids & capacities</h3>
            <ul className="space-y-2 text-sm">
              {fluids.map((f, i) => (
                <li key={i} className="flex flex-col">
                  <div className="font-medium">{f.system}</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {f.spec} · {f.capacity}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {parts.length > 0 ? (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <h3 className="font-semibold mb-3">Part numbers</h3>
            <ul className="space-y-1 text-sm">
              {parts.map((p, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>{p.name}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)] font-mono tabular-nums text-right">
                    {p.number}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* Specialists + insurance */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3">Specialists & contacts</h3>
          {vehicle.contacts.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">None yet.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {vehicle.contacts.map((c) => (
                <li
                  key={c.id}
                  className="rounded-xl border border-[var(--color-border)]/60 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-sm">{c.name}</div>
                    {c.role ? (
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {c.role}
                      </span>
                    ) : null}
                  </div>
                  {c.address ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-1">
                      {c.address}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                    {c.phone ? (
                      <a
                        href={`tel:${c.phone.replace(/\s+/g, "")}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Phone className="size-3" /> {c.phone}
                      </a>
                    ) : null}
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Mail className="size-3" /> {c.email}
                      </a>
                    ) : null}
                    {c.website ? (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--color-muted-foreground)] hover:underline"
                      >
                        {c.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : null}
                  </div>
                  {c.notes ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-1.5">
                      {c.notes}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {vehicle.insurer || vehicle.policyNumber ? (
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Shield className="size-4" /> Insurance
            </h3>
            <dl className="text-sm space-y-1">
              <Field label="Insurer" value={vehicle.insurer} />
              <Field label="Policy" value={vehicle.policyNumber} mono />
              <Field
                label="Period"
                value={
                  vehicle.policyEffective || vehicle.policyExpires
                    ? `${formatDate(vehicle.policyEffective)} – ${formatDate(vehicle.policyExpires)}`
                    : null
                }
              />
              {vehicle.insurerPhone ? (
                <div className="pt-1">
                  <a
                    href={`tel:${vehicle.insurerPhone.replace(/\s+/g, "")}`}
                    className="inline-flex items-center gap-1.5 text-sm hover:underline"
                  >
                    <Phone className="size-3.5" /> {vehicle.insurerPhone}
                  </a>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
      </div>

      {vehicle.notes ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 className="font-semibold mb-3">Driving & operating notes</h3>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-[var(--color-foreground)]/90">
            {vehicle.notes}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function intervalLabel(months: number | null, mileage: number | null, unit: string): string {
  const parts: string[] = [];
  if (months != null) {
    if (months % 12 === 0) parts.push(`${months / 12}y`);
    else parts.push(`${months}mo`);
  }
  if (mileage != null) parts.push(`${mileage.toLocaleString()} ${unit}`);
  return parts.length ? parts.join(" / ") : "—";
}

function MaintenanceCard({
  name,
  intervalLabel,
  lastPerformedAt,
  lastPerformedMileage,
  mileageUnit,
  notes,
  due,
}: {
  name: string;
  intervalLabel: string;
  lastPerformedAt: Date | string | null;
  lastPerformedMileage: number | null;
  mileageUnit: string;
  notes: string | null;
  due: { status: DueStatus; daysFromNow: number | null; milesFromNow: number | null };
}) {
  const c = statusColor(due.status);
  return (
    <li className={cn("rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2 ring-1", c.ring)}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium text-sm leading-snug">{name}</div>
        <StatusPill status={due.status} />
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
        Every {intervalLabel}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
        <div>
          <div className="text-[var(--color-muted-foreground)]">Last</div>
          <div className="tabular-nums">
            {formatDate(lastPerformedAt)}
            {lastPerformedMileage != null
              ? ` · ${lastPerformedMileage.toLocaleString()} ${mileageUnit}`
              : ""}
          </div>
        </div>
        <div>
          <div className="text-[var(--color-muted-foreground)]">Next due</div>
          <div className={cn("tabular-nums", c.text)}>
            {due.daysFromNow !== null
              ? formatRelativeDays(due.daysFromNow)
              : due.milesFromNow !== null
                ? formatRelativeMiles(due.milesFromNow, mileageUnit)
                : "—"}
          </div>
        </div>
      </div>
      {notes ? (
        <div className="text-xs text-[var(--color-muted-foreground)] mt-1 leading-snug">
          {notes}
        </div>
      ) : null}
    </li>
  );
}

function StatusPill({ status }: { status: DueStatus }) {
  const c = statusColor(status);
  const label =
    status === "overdue"
      ? "Overdue"
      : status === "due-soon"
        ? "Due soon"
        : status === "ok"
          ? "OK"
          : "Unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        c.bg,
        c.text
      )}
    >
      {status === "ok" ? <Check className="size-2.5" /> : null}
      {label}
    </span>
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
