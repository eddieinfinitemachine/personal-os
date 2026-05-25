import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDue } from "@/lib/maintenance";
import { getDefaultTodoList, isAuthorizedCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VEHICLE_POLICY_LEAD_DAYS = 14;
const VAX_BOOSTER_LEAD_DAYS = 30;

/**
 * Idempotency: every autopilot-created Todo has a stable `autopilotKey`
 * uniquely identifying the source event (e.g. `vehicle-policy:<vehicleId>:<expiresISO>`).
 * On each run we skip keys that already have an open todo.
 *
 * Legacy: older todos embedded the key as `[autopilot:<key>]` in notes.
 * We check both sources so the cron doesn't double-drop during the
 * transition; once those legacy todos are completed, only the column lookup
 * runs.
 */
async function existingKeys(userId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const [byColumn, legacy] = await Promise.all([
    prisma.todo.findMany({
      where: { userId, completedAt: null, autopilotKey: { not: null } },
      select: { autopilotKey: true },
    }),
    prisma.todo.findMany({
      where: {
        userId,
        completedAt: null,
        autopilotKey: null,
        notes: { contains: "[autopilot:" },
      },
      select: { notes: true },
    }),
  ]);
  for (const t of byColumn) {
    if (t.autopilotKey) set.add(t.autopilotKey);
  }
  for (const t of legacy) {
    if (!t.notes) continue;
    const m = t.notes.match(/\[autopilot:([^\]]+)\]/g);
    if (!m) continue;
    for (const tag of m) {
      // Strip the bracket wrapper to get the bare key.
      const bare = tag.slice("[autopilot:".length, -1);
      set.add(bare);
    }
  }
  return set;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  const list = await getDefaultTodoList(userId);
  if (!list) {
    return NextResponse.json(
      { error: "default 'To Do' list missing" },
      { status: 500 }
    );
  }

  const now = new Date();
  const policyHorizon = new Date(now);
  policyHorizon.setDate(policyHorizon.getDate() + VEHICLE_POLICY_LEAD_DAYS);
  const vaxHorizon = new Date(now);
  vaxHorizon.setDate(vaxHorizon.getDate() + VAX_BOOSTER_LEAD_DAYS);

  // Fan out the four independent reads in parallel.
  const [seen, vehicles, vaccinations, allItems] = await Promise.all([
    existingKeys(userId),
    prisma.vehicle.findMany({
      where: { userId, policyExpires: { gte: now, lte: policyHorizon } },
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.petVaccination.findMany({
      where: { userId, boosterDueAt: { gte: now, lte: vaxHorizon } },
      include: {
        pet: { include: { project: { select: { id: true, name: true } } } },
      },
    }),
    prisma.serviceItem.findMany({
      where: { userId },
      include: {
        vehicle: {
          select: {
            id: true,
            currentMileage: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  type TodoRow = {
    userId: string;
    title: string;
    notes: string;
    listId: string;
    projectId: string;
    dueDate: Date | null;
    autopilotKey: string;
  };
  const toCreate: TodoRow[] = [];
  const dropped: string[] = [];

  // 1. Vehicle insurance policies expiring within lead window.
  for (const v of vehicles) {
    const expIso = v.policyExpires!.toISOString().slice(0, 10);
    const key = `vehicle-policy:${v.id}:${expIso}`;
    if (seen.has(key)) continue;
    const days = Math.ceil(
      (v.policyExpires!.getTime() - now.getTime()) / 86_400_000
    );
    const phone = v.insurerPhone ? ` Call: ${v.insurerPhone}.` : "";
    const insurer = v.insurer ? ` (${v.insurer})` : "";
    toCreate.push({
      userId,
      title: `Renew ${v.project.name} insurance${insurer} — expires in ${days}d`,
      notes: `Policy ${v.policyNumber ?? ""} expires ${expIso}.${phone}`.trim(),
      listId: list.id,
      projectId: v.project.id,
      dueDate: v.policyExpires,
      autopilotKey: key,
    });
    dropped.push(key);
  }

  // 2. Pet vaccination boosters within lead window.
  for (const vax of vaccinations) {
    const dueIso = vax.boosterDueAt!.toISOString().slice(0, 10);
    const key = `vax:${vax.id}:${dueIso}`;
    if (seen.has(key)) continue;
    const days = Math.ceil(
      (vax.boosterDueAt!.getTime() - now.getTime()) / 86_400_000
    );
    const vetPhone = vax.pet.vetPhone ? ` Call: ${vax.pet.vetPhone}.` : "";
    const clinic = vax.pet.vetClinic ? ` (${vax.pet.vetClinic})` : "";
    toCreate.push({
      userId,
      title: `${vax.pet.project.name}: ${vax.name} booster due in ${days}d`,
      notes: `Booster due ${dueIso}.${vetPhone}${clinic}`.trim(),
      listId: list.id,
      projectId: vax.pet.project.id,
      dueDate: vax.boosterDueAt,
      autopilotKey: key,
    });
    dropped.push(key);
  }

  // 3. Vehicle ServiceItems that are overdue or due-soon.
  for (const item of allItems) {
    const due = computeDue(item, item.vehicle.currentMileage, now);
    if (due.status !== "overdue" && due.status !== "due-soon") continue;
    const dueIso = (due.dueAt ?? now).toISOString().slice(0, 10);
    const key = `service:${item.id}:${dueIso}`;
    if (seen.has(key)) continue;
    const verb = due.status === "overdue" ? "Overdue" : "Due soon";
    const detail =
      due.daysFromNow !== null
        ? due.daysFromNow >= 0
          ? `due in ${due.daysFromNow}d`
          : `${Math.abs(due.daysFromNow)}d overdue`
        : due.milesFromNow !== null
          ? due.milesFromNow >= 0
            ? `due in ${due.milesFromNow.toLocaleString()}mi`
            : `${Math.abs(due.milesFromNow).toLocaleString()}mi overdue`
          : "";
    toCreate.push({
      userId,
      title: `${item.vehicle.project.name}: ${item.name} — ${verb} (${detail})`,
      notes: `Service item flagged by autopilot.`,
      listId: list.id,
      projectId: item.vehicle.project.id,
      dueDate: due.dueAt,
      autopilotKey: key,
    });
    dropped.push(key);
  }

  // Single batched insert.
  if (toCreate.length > 0) {
    await prisma.todo.createMany({ data: toCreate });
  }

  return NextResponse.json({
    ok: true,
    droppedTodos: dropped.length,
    keys: dropped,
  });
}
