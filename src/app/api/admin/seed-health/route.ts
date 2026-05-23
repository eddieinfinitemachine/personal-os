import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPersonalRecord } from "@/lib/personal-record";

// Seed Eddie's health dashboard from his Quest lab PDFs at
// ~/Dropbox (Personal)/02_Personal/Health/Lab Results.
//
// Idempotent: re-seeding wipes existing labs / biometrics / visits / sessions
// for the Health project's Human row, then re-inserts.

type LabSeed = {
  panel: string;
  marker: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  flag: "low" | "normal" | "high";
};

type Draw = {
  date: string; // ISO date
  notes?: string;
  markers: LabSeed[];
};

// 2024-11-23 — first draw (Function Health · Quest)
const DRAW_1: Draw = {
  date: "2024-11-23",
  notes:
    "Baseline comprehensive panel. ApoB 87, LDL-P 1517, Pattern B, HDL-Large low. Free T elevated. Lipase + Amylase flagged high (one-time spike). TPO antibodies elevated (autoimmune thyroid signal).",
  markers: [
    // Lipids
    { panel: "Lipids", marker: "Total Cholesterol", value: 199, unit: "mg/dL", refLow: null, refHigh: 200, flag: "normal" },
    { panel: "Lipids", marker: "HDL Cholesterol", value: 66, unit: "mg/dL", refLow: 39, refHigh: null, flag: "normal" },
    { panel: "Lipids", marker: "Triglycerides", value: 90, unit: "mg/dL", refLow: null, refHigh: 150, flag: "normal" },
    { panel: "Lipids", marker: "LDL Cholesterol", value: 114, unit: "mg/dL", refLow: null, refHigh: 100, flag: "high" },
    { panel: "Lipids", marker: "Chol/HDL Ratio", value: 3.0, unit: "calc", refLow: null, refHigh: 5, flag: "normal" },
    { panel: "Lipids", marker: "Non-HDL Cholesterol", value: 133, unit: "mg/dL", refLow: null, refHigh: 130, flag: "high" },
    { panel: "Lipids", marker: "ApoB", value: 87, unit: "mg/dL", refLow: null, refHigh: 90, flag: "normal" },
    { panel: "Lipids", marker: "Lp(a)", value: 46, unit: "nmol/L", refLow: null, refHigh: 75, flag: "normal" },
    // LDL Particles
    { panel: "LDL Particles", marker: "LDL Particle Number", value: 1517, unit: "nmol/L", refLow: null, refHigh: 1138, flag: "high" },
    { panel: "LDL Particles", marker: "LDL Small", value: 337, unit: "nmol/L", refLow: null, refHigh: 142, flag: "high" },
    { panel: "LDL Particles", marker: "LDL Medium", value: 362, unit: "nmol/L", refLow: null, refHigh: 215, flag: "high" },
    { panel: "LDL Particles", marker: "HDL Large", value: 5866, unit: "nmol/L", refLow: 6729, refHigh: null, flag: "low" },
    { panel: "LDL Particles", marker: "LDL Peak Size", value: 215.8, unit: "Å", refLow: 222.9, refHigh: null, flag: "low" },
    // Metabolic
    { panel: "Metabolic", marker: "Hemoglobin A1c", value: 5.2, unit: "%", refLow: null, refHigh: 5.7, flag: "normal" },
    { panel: "Metabolic", marker: "Insulin", value: 8.4, unit: "uIU/mL", refLow: null, refHigh: 18.4, flag: "normal" },
    { panel: "Metabolic", marker: "Glucose (fasting)", value: 70, unit: "mg/dL", refLow: 65, refHigh: 99, flag: "normal" },
    { panel: "Metabolic", marker: "HS CRP", value: 1.7, unit: "mg/L", refLow: null, refHigh: 1.0, flag: "high" },
    { panel: "Metabolic", marker: "Uric Acid", value: 5.2, unit: "mg/dL", refLow: 4.0, refHigh: 8.0, flag: "normal" },
    { panel: "Metabolic", marker: "Homocysteine", value: 12.9, unit: "umol/L", refLow: null, refHigh: 11.4, flag: "high" },
    // Hormones
    { panel: "Hormones", marker: "Total Testosterone", value: 749, unit: "ng/dL", refLow: 250, refHigh: 1100, flag: "normal" },
    { panel: "Hormones", marker: "Free Testosterone", value: 180.5, unit: "pg/mL", refLow: 35, refHigh: 155, flag: "high" },
    { panel: "Hormones", marker: "DHEA Sulfate", value: 310, unit: "mcg/dL", refLow: 93, refHigh: 415, flag: "normal" },
    { panel: "Hormones", marker: "Cortisol (Total)", value: 13.7, unit: "mcg/dL", refLow: 4.6, refHigh: 20.6, flag: "normal" },
    { panel: "Hormones", marker: "Estradiol", value: 17, unit: "pg/mL", refLow: null, refHigh: 39, flag: "normal" },
    { panel: "Hormones", marker: "SHBG", value: 27, unit: "nmol/L", refLow: 10, refHigh: 50, flag: "normal" },
    { panel: "Hormones", marker: "FSH", value: 7.8, unit: "mIU/mL", refLow: 1.4, refHigh: 12.8, flag: "normal" },
    { panel: "Hormones", marker: "LH", value: 5.6, unit: "mIU/mL", refLow: 1.5, refHigh: 9.3, flag: "normal" },
    { panel: "Hormones", marker: "Prolactin", value: 5.1, unit: "ng/mL", refLow: 2.0, refHigh: 18.0, flag: "normal" },
    { panel: "Hormones", marker: "Leptin", value: 1.4, unit: "ng/mL", refLow: 0.3, refHigh: 13.4, flag: "normal" },
    // Thyroid
    { panel: "Thyroid", marker: "TSH", value: 1.70, unit: "mIU/L", refLow: 0.40, refHigh: 4.50, flag: "normal" },
    { panel: "Thyroid", marker: "Free T4", value: 1.0, unit: "ng/dL", refLow: 0.8, refHigh: 1.8, flag: "normal" },
    { panel: "Thyroid", marker: "Free T3", value: 3.1, unit: "pg/mL", refLow: 2.3, refHigh: 4.2, flag: "normal" },
    { panel: "Thyroid", marker: "TPO Antibodies", value: 37, unit: "IU/mL", refLow: null, refHigh: 9, flag: "high" },
    { panel: "Thyroid", marker: "Thyroglobulin Antibodies", value: 1, unit: "IU/mL", refLow: null, refHigh: 1, flag: "normal" },
    // Iron / Minerals
    { panel: "Iron / Minerals", marker: "Iron", value: 106, unit: "mcg/dL", refLow: 50, refHigh: 180, flag: "normal" },
    { panel: "Iron / Minerals", marker: "TIBC", value: 360, unit: "mcg/dL", refLow: 250, refHigh: 425, flag: "normal" },
    { panel: "Iron / Minerals", marker: "% Saturation", value: 29, unit: "%", refLow: 20, refHigh: 48, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Ferritin", value: 99, unit: "ng/mL", refLow: 38, refHigh: 380, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Magnesium RBC", value: 4.8, unit: "mg/dL", refLow: 4.0, refHigh: 6.4, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Zinc", value: 80, unit: "mcg/dL", refLow: 60, refHigh: 130, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Vitamin D 25-OH", value: 37, unit: "ng/mL", refLow: 30, refHigh: 100, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Methylmalonic Acid", value: 152, unit: "nmol/L", refLow: 55, refHigh: 335, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Mercury", value: 9, unit: "mcg/L", refLow: null, refHigh: 10, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Lead", value: 1.5, unit: "mcg/dL", refLow: null, refHigh: 3.5, flag: "normal" },
    // Liver / Pancreas
    { panel: "Liver / Pancreas", marker: "AST", value: 23, unit: "U/L", refLow: 10, refHigh: 40, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "ALT", value: 33, unit: "U/L", refLow: 9, refHigh: 46, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Alkaline Phosphatase", value: 46, unit: "U/L", refLow: 36, refHigh: 130, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "GGT", value: 15, unit: "U/L", refLow: 3, refHigh: 90, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Total Bilirubin", value: 0.7, unit: "mg/dL", refLow: 0.2, refHigh: 1.2, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Amylase", value: 162, unit: "U/L", refLow: 21, refHigh: 101, flag: "high" },
    { panel: "Liver / Pancreas", marker: "Lipase", value: 422, unit: "U/L", refLow: 7, refHigh: 60, flag: "high" },
    // Kidney / Electrolytes
    { panel: "Kidney / Electrolytes", marker: "Creatinine", value: 0.90, unit: "mg/dL", refLow: 0.60, refHigh: 1.26, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "eGFR", value: 117, unit: "mL/min/1.73m²", refLow: 60, refHigh: null, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "BUN", value: 22, unit: "mg/dL", refLow: 7, refHigh: 25, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Sodium", value: 139, unit: "mmol/L", refLow: 135, refHigh: 146, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Potassium", value: 4.2, unit: "mmol/L", refLow: 3.5, refHigh: 5.3, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Chloride", value: 101, unit: "mmol/L", refLow: 98, refHigh: 110, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "CO2", value: 31, unit: "mmol/L", refLow: 20, refHigh: 32, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Calcium", value: 9.5, unit: "mg/dL", refLow: 8.6, refHigh: 10.3, flag: "normal" },
    // CBC
    { panel: "CBC", marker: "WBC", value: 4.1, unit: "K/uL", refLow: 3.8, refHigh: 10.8, flag: "normal" },
    { panel: "CBC", marker: "RBC", value: 5.02, unit: "M/uL", refLow: 4.20, refHigh: 5.80, flag: "normal" },
    { panel: "CBC", marker: "Hemoglobin", value: 16.1, unit: "g/dL", refLow: 13.2, refHigh: 17.1, flag: "normal" },
    { panel: "CBC", marker: "Hematocrit", value: 48.0, unit: "%", refLow: 38.5, refHigh: 50.0, flag: "normal" },
    { panel: "CBC", marker: "Platelets", value: 262, unit: "K/uL", refLow: 140, refHigh: 400, flag: "normal" },
    // Prostate
    { panel: "Prostate", marker: "PSA Total", value: 0.2, unit: "ng/mL", refLow: null, refHigh: 4.0, flag: "normal" },
  ],
};

// 2025-08-22 — follow-up panel
const DRAW_2: Draw = {
  date: "2025-08-22",
  notes:
    "8-month follow-up. Inflammation/insulin/A1c improving — but lipid markers got worse: LDL-C 132, Non-HDL 146, HDL dropped to 52.",
  markers: [
    { panel: "Lipids", marker: "Total Cholesterol", value: 198, unit: "mg/dL", refLow: null, refHigh: 200, flag: "normal" },
    { panel: "Lipids", marker: "HDL Cholesterol", value: 52, unit: "mg/dL", refLow: 39, refHigh: null, flag: "normal" },
    { panel: "Lipids", marker: "Triglycerides", value: 58, unit: "mg/dL", refLow: null, refHigh: 150, flag: "normal" },
    { panel: "Lipids", marker: "LDL Cholesterol", value: 132, unit: "mg/dL", refLow: null, refHigh: 100, flag: "high" },
    { panel: "Lipids", marker: "Chol/HDL Ratio", value: 3.8, unit: "calc", refLow: null, refHigh: 5, flag: "normal" },
    { panel: "Lipids", marker: "Non-HDL Cholesterol", value: 146, unit: "mg/dL", refLow: null, refHigh: 130, flag: "high" },
    { panel: "Metabolic", marker: "Hemoglobin A1c", value: 5.0, unit: "%", refLow: null, refHigh: 5.7, flag: "normal" },
    { panel: "Metabolic", marker: "Insulin", value: 3.0, unit: "uIU/mL", refLow: null, refHigh: 18.4, flag: "normal" },
    { panel: "Metabolic", marker: "Glucose (fasting)", value: 77, unit: "mg/dL", refLow: 65, refHigh: 99, flag: "normal" },
    { panel: "Metabolic", marker: "HS CRP", value: 0.5, unit: "mg/L", refLow: null, refHigh: 1.0, flag: "normal" },
    // Omega
    { panel: "Omega", marker: "OmegaCheck (EPA+DPA+DHA)", value: 6.2, unit: "% by wt", refLow: 5.5, refHigh: null, flag: "normal" },
    { panel: "Omega", marker: "EPA", value: 1.1, unit: "% by wt", refLow: 0.2, refHigh: 2.3, flag: "normal" },
    { panel: "Omega", marker: "DPA", value: 1.5, unit: "% by wt", refLow: 0.8, refHigh: 1.8, flag: "normal" },
    { panel: "Omega", marker: "DHA", value: 3.6, unit: "% by wt", refLow: 1.4, refHigh: 5.1, flag: "normal" },
    { panel: "Omega", marker: "AA/EPA Ratio", value: 13.1, unit: "ratio", refLow: 3.7, refHigh: 40.7, flag: "normal" },
    { panel: "Omega", marker: "Omega-6/Omega-3 Ratio", value: 6.8, unit: "ratio", refLow: 3.7, refHigh: 14.4, flag: "normal" },
    // CBC
    { panel: "CBC", marker: "WBC", value: 4.4, unit: "K/uL", refLow: 3.8, refHigh: 10.8, flag: "normal" },
    { panel: "CBC", marker: "Hemoglobin", value: 15.6, unit: "g/dL", refLow: 13.2, refHigh: 17.1, flag: "normal" },
    { panel: "CBC", marker: "Hematocrit", value: 46.2, unit: "%", refLow: 38.5, refHigh: 50.0, flag: "normal" },
    { panel: "CBC", marker: "Platelets", value: 246, unit: "K/uL", refLow: 140, refHigh: 400, flag: "normal" },
    // CMP highlights
    { panel: "Kidney / Electrolytes", marker: "Creatinine", value: 0.96, unit: "mg/dL", refLow: 0.60, refHigh: 1.26, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "eGFR", value: 108, unit: "mL/min/1.73m²", refLow: 60, refHigh: null, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "AST", value: 33, unit: "U/L", refLow: 10, refHigh: 40, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "ALT", value: 32, unit: "U/L", refLow: 9, refHigh: 46, flag: "normal" },
  ],
};

// 2026-03-26 — most recent comprehensive draw (reported 4/2/2026)
// Includes the 4/1/2026 thyroid antibody addendum (TSI/TRAB/TBG, same collection date).
const DRAW_3: Draw = {
  date: "2026-03-26",
  notes:
    "Latest comprehensive draw. ApoB back to 97 (worse than baseline). LDL-P 1567, LDL-Small 431 (much worse). HDL recovered to 64. Free T normalized. WBC trended down to 3.3 (low). TPO antibodies still elevated. Lipase/amylase normal — prior spike resolved. TSI/TRAB normal (Graves' negative). Vitamin D 30 — replenishment slipped.",
  markers: [
    // Lipids
    { panel: "Lipids", marker: "Total Cholesterol", value: 203, unit: "mg/dL", refLow: null, refHigh: 200, flag: "high" },
    { panel: "Lipids", marker: "HDL Cholesterol", value: 64, unit: "mg/dL", refLow: 39, refHigh: null, flag: "normal" },
    { panel: "Lipids", marker: "Triglycerides", value: 92, unit: "mg/dL", refLow: null, refHigh: 150, flag: "normal" },
    { panel: "Lipids", marker: "LDL Cholesterol", value: 119, unit: "mg/dL", refLow: null, refHigh: 100, flag: "high" },
    { panel: "Lipids", marker: "Chol/HDL Ratio", value: 3.2, unit: "calc", refLow: null, refHigh: 5, flag: "normal" },
    { panel: "Lipids", marker: "Non-HDL Cholesterol", value: 139, unit: "mg/dL", refLow: null, refHigh: 130, flag: "high" },
    { panel: "Lipids", marker: "ApoB", value: 97, unit: "mg/dL", refLow: null, refHigh: 90, flag: "high" },
    { panel: "Lipids", marker: "Lp(a)", value: 57, unit: "nmol/L", refLow: null, refHigh: 75, flag: "normal" },
    // LDL Particles
    { panel: "LDL Particles", marker: "LDL Particle Number", value: 1567, unit: "nmol/L", refLow: null, refHigh: 1138, flag: "high" },
    { panel: "LDL Particles", marker: "LDL Small", value: 431, unit: "nmol/L", refLow: null, refHigh: 142, flag: "high" },
    { panel: "LDL Particles", marker: "LDL Medium", value: 345, unit: "nmol/L", refLow: null, refHigh: 215, flag: "high" },
    { panel: "LDL Particles", marker: "HDL Large", value: 5204, unit: "nmol/L", refLow: 6729, refHigh: null, flag: "low" },
    { panel: "LDL Particles", marker: "LDL Peak Size", value: 213.7, unit: "Å", refLow: 222.9, refHigh: null, flag: "low" },
    // Metabolic
    { panel: "Metabolic", marker: "Hemoglobin A1c", value: 5.1, unit: "%", refLow: null, refHigh: 5.7, flag: "normal" },
    { panel: "Metabolic", marker: "Insulin", value: 6.5, unit: "uIU/mL", refLow: null, refHigh: 18.4, flag: "normal" },
    { panel: "Metabolic", marker: "Glucose (fasting)", value: 74, unit: "mg/dL", refLow: 65, refHigh: 99, flag: "normal" },
    { panel: "Metabolic", marker: "HS CRP", value: 0.6, unit: "mg/L", refLow: null, refHigh: 1.0, flag: "normal" },
    { panel: "Metabolic", marker: "Uric Acid", value: 5.7, unit: "mg/dL", refLow: 4.0, refHigh: 8.0, flag: "normal" },
    { panel: "Metabolic", marker: "Homocysteine", value: 11.1, unit: "umol/L", refLow: null, refHigh: 13.5, flag: "normal" },
    // Hormones
    { panel: "Hormones", marker: "Total Testosterone", value: 635, unit: "ng/dL", refLow: 250, refHigh: 1100, flag: "normal" },
    { panel: "Hormones", marker: "Free Testosterone", value: 116.8, unit: "pg/mL", refLow: 35, refHigh: 155, flag: "normal" },
    { panel: "Hormones", marker: "DHEA Sulfate", value: 267, unit: "mcg/dL", refLow: 93, refHigh: 415, flag: "normal" },
    { panel: "Hormones", marker: "Cortisol (Total)", value: 11.3, unit: "mcg/dL", refLow: 4.6, refHigh: 20.6, flag: "normal" },
    { panel: "Hormones", marker: "SHBG", value: 28, unit: "nmol/L", refLow: 10, refHigh: 50, flag: "normal" },
    { panel: "Hormones", marker: "FSH", value: 7.2, unit: "mIU/mL", refLow: 1.4, refHigh: 12.8, flag: "normal" },
    { panel: "Hormones", marker: "LH", value: 3.1, unit: "mIU/mL", refLow: 1.5, refHigh: 9.3, flag: "normal" },
    { panel: "Hormones", marker: "Prolactin", value: 4.4, unit: "ng/mL", refLow: 2.0, refHigh: 18.0, flag: "normal" },
    { panel: "Hormones", marker: "Leptin", value: 0.9, unit: "ng/mL", refLow: 0.3, refHigh: 13.4, flag: "normal" },
    // Thyroid
    { panel: "Thyroid", marker: "TSH", value: 1.10, unit: "mIU/L", refLow: 0.40, refHigh: 4.50, flag: "normal" },
    { panel: "Thyroid", marker: "Free T4", value: 1.2, unit: "ng/dL", refLow: 0.8, refHigh: 1.8, flag: "normal" },
    { panel: "Thyroid", marker: "Free T3", value: 3.6, unit: "pg/mL", refLow: 2.3, refHigh: 4.2, flag: "normal" },
    { panel: "Thyroid", marker: "TPO Antibodies", value: 34, unit: "IU/mL", refLow: null, refHigh: 9, flag: "high" },
    { panel: "Thyroid", marker: "Thyroglobulin Antibodies", value: 2, unit: "IU/mL", refLow: null, refHigh: 2, flag: "normal" },
    { panel: "Thyroid", marker: "TSI", value: 89, unit: "% baseline", refLow: null, refHigh: 140, flag: "normal" },
    { panel: "Thyroid", marker: "TRAB", value: 1.0, unit: "IU/L", refLow: null, refHigh: 2.0, flag: "normal" },
    { panel: "Thyroid", marker: "TBG", value: 19.3, unit: "mcg/mL", refLow: 12.7, refHigh: 25.1, flag: "normal" },
    // Iron / Minerals
    { panel: "Iron / Minerals", marker: "Iron", value: 133, unit: "mcg/dL", refLow: 50, refHigh: 180, flag: "normal" },
    { panel: "Iron / Minerals", marker: "TIBC", value: 366, unit: "mcg/dL", refLow: 250, refHigh: 425, flag: "normal" },
    { panel: "Iron / Minerals", marker: "% Saturation", value: 36, unit: "%", refLow: 20, refHigh: 48, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Ferritin", value: 91, unit: "ng/mL", refLow: 38, refHigh: 380, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Magnesium RBC", value: 4.8, unit: "mg/dL", refLow: 4.0, refHigh: 6.4, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Zinc", value: 74, unit: "mcg/dL", refLow: 60, refHigh: 130, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Vitamin D 25-OH", value: 30, unit: "ng/mL", refLow: 30, refHigh: 100, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Methylmalonic Acid", value: 157, unit: "nmol/L", refLow: 55, refHigh: 335, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Mercury", value: 7, unit: "mcg/L", refLow: null, refHigh: 10, flag: "normal" },
    { panel: "Iron / Minerals", marker: "Lead", value: 1.2, unit: "mcg/dL", refLow: null, refHigh: 3.5, flag: "normal" },
    // Liver / Pancreas
    { panel: "Liver / Pancreas", marker: "AST", value: 25, unit: "U/L", refLow: 10, refHigh: 40, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "ALT", value: 38, unit: "U/L", refLow: 9, refHigh: 46, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Alkaline Phosphatase", value: 45, unit: "U/L", refLow: 36, refHigh: 130, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "GGT", value: 18, unit: "U/L", refLow: 3, refHigh: 90, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Total Bilirubin", value: 0.8, unit: "mg/dL", refLow: 0.2, refHigh: 1.2, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Amylase", value: 52, unit: "U/L", refLow: 21, refHigh: 101, flag: "normal" },
    { panel: "Liver / Pancreas", marker: "Lipase", value: 19, unit: "U/L", refLow: 7, refHigh: 60, flag: "normal" },
    // Kidney / Electrolytes
    { panel: "Kidney / Electrolytes", marker: "Creatinine", value: 0.97, unit: "mg/dL", refLow: 0.60, refHigh: 1.26, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "eGFR", value: 106, unit: "mL/min/1.73m²", refLow: 60, refHigh: null, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "BUN", value: 18, unit: "mg/dL", refLow: 7, refHigh: 25, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Sodium", value: 143, unit: "mmol/L", refLow: 135, refHigh: 146, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Potassium", value: 4.3, unit: "mmol/L", refLow: 3.5, refHigh: 5.3, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Chloride", value: 103, unit: "mmol/L", refLow: 98, refHigh: 110, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "CO2", value: 31, unit: "mmol/L", refLow: 20, refHigh: 32, flag: "normal" },
    { panel: "Kidney / Electrolytes", marker: "Calcium", value: 9.8, unit: "mg/dL", refLow: 8.6, refHigh: 10.3, flag: "normal" },
    // CBC
    { panel: "CBC", marker: "WBC", value: 3.3, unit: "K/uL", refLow: 3.8, refHigh: 10.8, flag: "low" },
    { panel: "CBC", marker: "RBC", value: 5.19, unit: "M/uL", refLow: 4.20, refHigh: 5.80, flag: "normal" },
    { panel: "CBC", marker: "Hemoglobin", value: 15.8, unit: "g/dL", refLow: 13.2, refHigh: 17.1, flag: "normal" },
    { panel: "CBC", marker: "Hematocrit", value: 49.2, unit: "%", refLow: 38.5, refHigh: 50.0, flag: "normal" },
    { panel: "CBC", marker: "Platelets", value: 241, unit: "K/uL", refLow: 140, refHigh: 400, flag: "normal" },
    // Omega
    { panel: "Omega", marker: "OmegaCheck (EPA+DPA+DHA)", value: 6.4, unit: "% by wt", refLow: 5.5, refHigh: null, flag: "normal" },
    { panel: "Omega", marker: "EPA", value: 1.0, unit: "% by wt", refLow: 0.2, refHigh: 2.3, flag: "normal" },
    { panel: "Omega", marker: "DPA", value: 1.4, unit: "% by wt", refLow: 0.8, refHigh: 1.8, flag: "normal" },
    { panel: "Omega", marker: "DHA", value: 4.0, unit: "% by wt", refLow: 1.4, refHigh: 5.1, flag: "normal" },
    { panel: "Omega", marker: "AA/EPA Ratio", value: 12.6, unit: "ratio", refLow: 3.7, refHigh: 40.7, flag: "normal" },
    { panel: "Omega", marker: "Omega-6/Omega-3 Ratio", value: 6.4, unit: "ratio", refLow: 3.7, refHigh: 14.4, flag: "normal" },
    // Prostate
    { panel: "Prostate", marker: "PSA Total", value: 0.3, unit: "ng/mL", refLow: null, refHigh: 4.0, flag: "normal" },
  ],
};

const ALL_DRAWS: Draw[] = [DRAW_1, DRAW_2, DRAW_3];

const SUPPLEMENTS = [
  { name: "Vitamin D3", dosage: "2,000–5,000 IU", frequency: "morning, with breakfast (fat-soluble)" },
  { name: "Vitamin K2 (MK-7)", dosage: "100–200 mcg", frequency: "morning, with breakfast" },
  { name: "Fish Oil (EPA/DHA)", dosage: "2–4g combined", frequency: "split AM/PM with meals" },
  { name: "Psyllium Husk", dosage: "5–10g in water", frequency: "before meals" },
  { name: "CoQ10", dosage: "100–200mg", frequency: "with meals" },
  { name: "Citrus Bergamot", dosage: "500–1000mg", frequency: "before evening meal" },
  { name: "Magnesium Glycinate", dosage: "200–400mg", frequency: "before bed" },
];

const HEALTH_NOTE = `## Trajectory across 3 draws (Nov 2024 → Mar 2026)

**Cardio markers — mixed:**
- ApoB: 87 → ?? → **97** (worse, target <80)
- LDL-P: 1517 → ?? → **1567** (worse, target <1138)
- LDL-Small: 337 → ?? → **431** (much worse)
- HDL-C: 66 → 52 → **64** (recovered)
- HDL-Large: 5866 → ?? → **5204** (worse, target >6729)
- LDL Pattern: still **B** across all 3 draws

**Metabolic markers — improving:**
- A1c: 5.2 → 5.0 → 5.1
- Insulin: 8.4 → 3.0 → 6.5
- HS-CRP: 1.7 → 0.5 → **0.6** (excellent)

**Hormones — Free T normalized:**
- Free T: 180.5 H → ?? → **116.8** (in range)
- Total T: 749 → 635 (still good)

**New flags to monitor:**
- TPO Antibodies still 34 (autoimmune thyroid signal — Graves' negative per TSI/TRAB)
- WBC dropped from 4.4 → **3.3 (low)**
- Vitamin D 30 (low end of optimal — supplement adherence)

**Resolved:**
- Lipase 422 → 19 (one-time spike, no longer a concern)
- Amylase 162 → 52

## Health goals (cardio focus)
1. Lower ApoB — target < 80 mg/dL
2. Shift LDL Pattern B → Pattern A
3. Reduce LDL Particle Number — target < 1138 nmol/L
4. Raise HDL Large — target > 6729 nmol/L

## Weekly training plan
- **Mon / Wed / Fri** — Zone 2 cardio, 40m + post-meal walks
- **Tue** — Upper body strength
- **Thu** — Lower body
- **Sat** — Full body + hike (60–90m)
- **Sun** — Active recovery`;

export async function POST() {
  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  const record = await getPersonalRecord(prisma, userId);
  if (!record) {
    return NextResponse.json(
      { error: "founder PersonalRecord missing — run scripts/seed-personal-record.ts first" },
      { status: 500 },
    );
  }

  let project = await prisma.project.findFirst({
    where: { userId, name: "Health", archived: false },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        userId,
        name: "Health",
        kind: "human",
        icon: "Heart",
        color: "rose",
      },
    });
  } else if (project.kind !== "human") {
    project = await prisma.project.update({
      where: { id: project.id },
      data: { kind: "human" },
    });
  }

  const existing = await prisma.human.findUnique({
    where: { projectId: project.id },
  });

  const humanData = {
    fullName: record.fullName,
    sex: "M",
    birthDate: new Date(record.birth.date),
    primaryCarePhysician: "Joshua A. Emdur, D.O.",
    medicationsJson: SUPPLEMENTS,
    notes: HEALTH_NOTE,
  };

  let human;
  if (existing) {
    await prisma.$transaction([
      prisma.labResult.deleteMany({ where: { humanId: existing.id, userId } }),
      prisma.medicalVisit.deleteMany({ where: { humanId: existing.id, userId } }),
    ]);
    human = await prisma.human.update({
      where: { id: existing.id },
      data: humanData,
    });
  } else {
    human = await prisma.human.create({
      data: { ...humanData, projectId: project.id, userId },
    });
  }

  let totalLabs = 0;
  for (const draw of ALL_DRAWS) {
    const drawnAt = new Date(draw.date);
    await prisma.labResult.createMany({
      data: draw.markers.map((m) => ({
        humanId: human.id,
        userId,
        drawnAt,
        panel: m.panel,
        marker: m.marker,
        value: m.value,
        unit: m.unit,
        refLow: m.refLow,
        refHigh: m.refHigh,
        flag: m.flag,
      })),
    });
    totalLabs += draw.markers.length;

    await prisma.medicalVisit.create({
      data: {
        humanId: human.id,
        userId,
        performedAt: drawnAt,
        providerName: "Quest Diagnostics",
        specialty: "lab work",
        reason: draw.notes ?? "Lab draw",
      },
    });
  }

  return NextResponse.json({
    ok: true,
    projectId: project.id,
    humanId: human.id,
    seeded: { draws: ALL_DRAWS.length, labs: totalLabs },
  });
}
