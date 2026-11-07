// What the Health page shows beyond the summary: plain names for biometric
// kinds and booster status. The page and GET /api/health/summary share these,
// so the web and the app read the same records the same way.

/** Plain names for biometric kinds, in the order they appear. Any other kind shows as stored. */
export const BIOMETRIC_LABELS: Record<string, string> = {
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
  hrv: "HRV",
  vo2: "VO2 max",
  steps: "Steps",
  sleep: "Sleep",
};
const BIOMETRIC_ORDER = Object.keys(BIOMETRIC_LABELS);

export function biometricLabel(kind: string): string {
  return BIOMETRIC_LABELS[kind] ?? kind;
}

/** Position in BIOMETRIC_LABELS; unlabeled kinds go last. */
export function biometricRank(kind: string): number {
  const rank = BIOMETRIC_ORDER.indexOf(kind);
  return rank === -1 ? BIOMETRIC_ORDER.length : rank;
}

export type VaccinationStatus = "overdue" | "due-soon" | "ok";

export const BOOSTER_DUE_SOON_DAYS = 60;

/** A booster date in the past is overdue; one within the next 60 days is due soon. No booster date is ok. */
export function vaccinationStatus(boosterDueAt: Date | null, now: Date): VaccinationStatus {
  if (!boosterDueAt) return "ok";
  if (boosterDueAt < now) return "overdue";
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + BOOSTER_DUE_SOON_DAYS);
  return boosterDueAt <= horizon ? "due-soon" : "ok";
}
