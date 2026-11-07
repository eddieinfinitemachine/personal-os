import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { biometricLabel, biometricRank, vaccinationStatus } from "@/lib/health/dashboard";
import { findHealthProjectId, loadHealthSummary } from "@/lib/health/load";
import { isPictureStale, pictureFailureClass, readStoredPicture } from "@/lib/health/picture";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = { "Cache-Control": "private, no-store" };

const EMPTY = {
  projectId: null,
  human: null,
  summary: null,
  picture: { stored: null, stale: false, generatedAt: null },
  vaccinations: [],
  visits: [],
  dna: [],
  biometrics: [],
  fitnessSessions: [],
};

/** The Health page's record, with the same limits it shows. The policy number is never read. */
function readHuman(projectId: string) {
  return prisma.human.findUnique({
    where: { projectId },
    select: {
      id: true,
      userId: true,
      fullName: true,
      sex: true,
      birthDate: true,
      bloodType: true,
      heightInches: true,
      primaryCarePhysician: true,
      pcpPhone: true,
      insurer: true,
      insurerPhone: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      notes: true,
      medicationsJson: true,
      conditionsJson: true,
      allergiesJson: true,
      pictureJson: true,
      // The latest of each kind, so daily readings can't crowd out a one-off.
      biometrics: {
        orderBy: [{ kind: "asc" }, { measuredAt: "desc" }],
        distinct: ["kind"],
        select: { kind: true, value: true, unit: true, measuredAt: true, source: true },
      },
      vaccinations: {
        orderBy: { administeredAt: "desc" },
        take: 12,
        select: { id: true, name: true, administeredAt: true, boosterDueAt: true, provider: true, notes: true },
      },
      medicalVisits: {
        orderBy: { performedAt: "desc" },
        take: 12,
        select: { id: true, performedAt: true, providerName: true, specialty: true, reason: true, summary: true },
      },
      dnaResults: {
        orderBy: { reportedAt: "desc" },
        take: 30,
        select: { id: true, category: true, title: true, finding: true, detail: true, source: true, reportedAt: true },
      },
      fitnessSessions: {
        orderBy: { performedAt: "desc" },
        take: 12,
        select: {
          id: true,
          performedAt: true,
          kind: true,
          durationMin: true,
          distanceMi: true,
          caloriesKcal: true,
          avgHr: true,
          maxHr: true,
          notes: true,
          source: true,
        },
      },
    },
  });
}

/**
 * Everything the Health page shows, as JSON for the native app. Read-only: it
 * never writes the picture. When `picture.stale` is true the app POSTs
 * /api/projects/[id]/picture, as the page does.
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });

  try {
    const projectId = await findHealthProjectId(userId);
    if (!projectId) return NextResponse.json(EMPTY, { headers });
    const human = await readHuman(projectId);
    if (!human) return NextResponse.json({ ...EMPTY, projectId }, { headers });

    const now = new Date();
    const summary = await loadHealthSummary(human, now);
    const stored = readStoredPicture(human.pictureJson);
    // As on the page: without labs there is nothing to write a picture from.
    const stale = summary.labs.markers.length > 0 && isPictureStale(stored, summary, now);

    return NextResponse.json(
      {
        projectId,
        human: {
          id: human.id,
          fullName: human.fullName,
          sex: human.sex,
          birthDate: human.birthDate,
          bloodType: human.bloodType,
          heightInches: human.heightInches,
          careTeam: {
            primaryCarePhysician: human.primaryCarePhysician,
            pcpPhone: human.pcpPhone,
            insurer: human.insurer,
            insurerPhone: human.insurerPhone,
            emergencyContactName: human.emergencyContactName,
            emergencyContactPhone: human.emergencyContactPhone,
          },
        },
        summary,
        picture: { stored, stale, generatedAt: stored?.generatedAt ?? null },
        vaccinations: human.vaccinations.map((v) => ({ ...v, status: vaccinationStatus(v.boosterDueAt, now) })),
        visits: human.medicalVisits,
        dna: human.dnaResults,
        biometrics: [...human.biometrics]
          .sort((a, b) => biometricRank(a.kind) - biometricRank(b.kind))
          .map((b) => ({
            kind: b.kind,
            label: biometricLabel(b.kind),
            value: b.value,
            unit: b.unit,
            measuredAt: b.measuredAt,
            source: b.source,
          })),
        fitnessSessions: human.fitnessSessions,
      },
      { headers },
    );
  } catch (error) {
    // The failure type only: messages from these errors can quote health data.
    console.error(`health summary failed: ${pictureFailureClass(error)}`);
    return NextResponse.json({ error: "Could not load health data. Try again." }, { status: 500, headers });
  }
}
