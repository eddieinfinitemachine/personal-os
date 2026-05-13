import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDue } from "@/lib/maintenance";
import { getDefaultTodoList, isAuthorizedCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VEHICLE_POLICY_LEAD_DAYS = 14;
const VAX_BOOSTER_LEAD_DAYS = 30;

/**
 * Idempotency: every autopilot-created Todo has a hidden marker in `notes`.
 * Format: `[autopilot:<key>]` where <key> uniquely identifies the source
 * event (e.g. `vehicle-policy:<vehicleId>:<expiresISO>`). On each run we skip
 * keys that already have an open todo.
 */
function marker(key: string): string {
  return `[autopilot:${key}]`;
}

async function existingMarkers(): Promise<Set<string>> {
  const todos = await prisma.todo.findMany({
    where: { completedAt: null, notes: { contains: "[autopilot:" } },
    select: { notes: true },
  });
  const set = new Set<string>();
  for (const t of todos) {
    if (!t.notes) continue;
    const m = t.notes.match(/\[autopilot:([^\]]+)\]/g);
    if (!m) continue;
    for (const tag of m) set.add(tag);
  }
  return set;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const list = await getDefaultTodoList();
  if (!list) {
    return NextResponse.json(
      { error: "default 'To Do' list missing" },
      { status: 500 }
    );
  }

  const now = new Date();
  const dropped: string[] = [];
  const seen = await existingMarkers();

  // 1. Vehicle insurance policies expiring within lead window.
  const policyHorizon = new Date(now);
  policyHorizon.setDate(policyHorizon.getDate() + VEHICLE_POLICY_LEAD_DAYS);
  const vehicles = await prisma.vehicle.findMany({
    where: {
      policyExpires: { gte: now, lte: policyHorizon },
    },
    include: { project: { select: { id: true, name: true } } },
  });
  for (const v of vehicles) {
    const expIso = v.policyExpires!.toISOString().slice(0, 10);
    const key = `vehicle-policy:${v.id}:${expIso}`;
    const tag = marker(key);
    if (seen.has(tag)) continue;
    const days = Math.ceil(
      (v.policyExpires!.getTime() - now.getTime()) / 86_400_000
    );
    const phone = v.insurerPhone ? ` Call: ${v.insurerPhone}.` : "";
    const insurer = v.insurer ? ` (${v.insurer})` : "";
    await prisma.todo.create({
      data: {
        title: `Renew ${v.project.name} insurance${insurer} — expires in ${days}d`,
        notes: `Policy ${v.policyNumber ?? ""} expires ${expIso}.${phone} ${tag}`.trim(),
        listId: list.id,
        projectId: v.project.id,
        dueDate: v.policyExpires,
      },
    });
    dropped.push(key);
  }

  // 2. Pet vaccination boosters within lead window.
  const vaxHorizon = new Date(now);
  vaxHorizon.setDate(vaxHorizon.getDate() + VAX_BOOSTER_LEAD_DAYS);
  const vaccinations = await prisma.petVaccination.findMany({
    where: {
      boosterDueAt: { gte: now, lte: vaxHorizon },
    },
    include: {
      pet: {
        include: { project: { select: { id: true, name: true } } },
      },
    },
  });
  for (const vax of vaccinations) {
    const dueIso = vax.boosterDueAt!.toISOString().slice(0, 10);
    const key = `vax:${vax.id}:${dueIso}`;
    const tag = marker(key);
    if (seen.has(tag)) continue;
    const days = Math.ceil(
      (vax.boosterDueAt!.getTime() - now.getTime()) / 86_400_000
    );
    const vetPhone = vax.pet.vetPhone ? ` Call: ${vax.pet.vetPhone}.` : "";
    const clinic = vax.pet.vetClinic ? ` (${vax.pet.vetClinic})` : "";
    await prisma.todo.create({
      data: {
        title: `${vax.pet.project.name}: ${vax.name} booster due in ${days}d`,
        notes: `Booster due ${dueIso}.${vetPhone}${clinic} ${tag}`.trim(),
        listId: list.id,
        projectId: vax.pet.project.id,
        dueDate: vax.boosterDueAt,
      },
    });
    dropped.push(key);
  }

  // 3. Vehicle ServiceItems that are overdue or due-soon.
  const allItems = await prisma.serviceItem.findMany({
    include: {
      vehicle: {
        select: {
          id: true,
          currentMileage: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
  });
  for (const item of allItems) {
    const due = computeDue(item, item.vehicle.currentMileage, now);
    if (due.status !== "overdue" && due.status !== "due-soon") continue;
    const dueIso = (due.dueAt ?? now).toISOString().slice(0, 10);
    const key = `service:${item.id}:${dueIso}`;
    const tag = marker(key);
    if (seen.has(tag)) continue;
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
    await prisma.todo.create({
      data: {
        title: `${item.vehicle.project.name}: ${item.name} — ${verb} (${detail})`,
        notes: `Service item flagged by autopilot. ${tag}`,
        listId: list.id,
        projectId: item.vehicle.project.id,
        dueDate: due.dueAt,
      },
    });
    dropped.push(key);
  }

  return NextResponse.json({
    ok: true,
    droppedTodos: dropped.length,
    keys: dropped,
  });
}
