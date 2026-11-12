import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { findOwnProject, getProjectTasks, projectContentWhere, toProjectSummary } from "@/lib/project-detail";
import { loadVehicleDashboard, vehicleDashboardJson } from "@/lib/vehicle-dashboard";
import { loadPetDashboard, petDashboardJson } from "@/lib/pet-dashboard";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * What /projects/[id] reads, for the native app: the project, its note and
 * file counts, the Tasks tab (the caller's three default lists) and, for a
 * vehicle or pet, the dashboard's data. Someone else's project is 404, as on
 * the page. A human project's dashboard is served by /api/health/*.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  const { id } = await params;
  const project = await findOwnProject(userId, id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404, headers });

  const now = new Date();
  const [tasks, notesCount, attachmentsCount, vehicle, pet] = await Promise.all([
    getProjectTasks(userId, id, now),
    prisma.note.count({ where: projectContentWhere(userId, id) }),
    prisma.attachment.count({ where: projectContentWhere(userId, id) }),
    project.kind === "vehicle" ? loadVehicleDashboard(id) : null,
    project.kind === "pet" ? loadPetDashboard(id) : null,
  ]);

  return NextResponse.json(
    {
      project: toProjectSummary(project),
      notesCount,
      attachmentsCount,
      tasks,
      vehicle: vehicle ? vehicleDashboardJson(vehicle, now) : null,
      pet: pet ? petDashboardJson(pet, now) : null,
    },
    { headers },
  );
}
