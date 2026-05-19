import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PROJECT_NAME = "Ferrari 456 GT";

const FLUIDS = [
  { system: "Engine oil", spec: "Mobil 1 5W-40 (last used) or Pennzoil Platinum Euro 5W-40", capacity: "12 quarts (with filter)" },
  { system: "Gearbox / transaxle", spec: "Shell Spirax 75W-90 GL-5", capacity: "≈ 4.5 quarts" },
  { system: "Coolant", spec: "Peak Euro Yellow (or any OAT-compatible Italian-spec coolant)", capacity: "≈ 22 litres" },
  { system: "Brake fluid", spec: "DOT 4", capacity: "Flush full system" },
  { system: "Power steering", spec: "Shell Power Steering Fluid", capacity: "Top off as needed" },
  { system: "Fuel", spec: "Premium unleaded, 93 octane (US) / 98 RON", capacity: "110 litres" },
];

const PARTS = [
  { name: "Oil filter", number: "Ferrari 456/550 P/N 206166 (FIL206166)" },
  { name: "Fuel filter", number: "FLT186922" },
  { name: "Spark plugs", number: "Iridium, qty 12, P/N 174954A" },
  { name: "Air filters", number: "P/N 151562 (qty 2)" },
  { name: "Cabin/pollen filter", number: "P/N 63897800" },
  { name: "Water pump", number: "PUM177561" },
  { name: "Timing belt", number: "11187744" },
  { name: "Timing belt tensioner", number: "171057" },
  { name: "Cam cover gaskets RH/LH", number: "GAS140753" },
];

const PERFORMANCE = [
  { label: "Engine", value: "5,474 cc naturally-aspirated 65° V12 (Tipo F116 B)" },
  { label: "Power", value: "≈ 442 PS (436 hp / 325 kW) @ 6,250 rpm" },
  { label: "Torque", value: "≈ 550 Nm (406 lb-ft) @ 4,500 rpm" },
  { label: "0–100 km/h", value: "≈ 5.2 seconds" },
  { label: "Top Speed", value: "≈ 300 km/h (186 mph)" },
  { label: "Weight Distribution", value: "51% front / 49% rear" },
  { label: "Kerb Weight", value: "≈ 1,690 kg" },
  { label: "Fuel Capacity", value: "110 litres (29 US gal)" },
];

const SERVICE_ITEMS = [
  {
    name: "Engine oil & filter",
    intervalMonths: 12,
    intervalMileage: 5000,
    notes: "Mobil 1 5W-40 (12.5 qts) — last used by J. Scuderia",
    lastPerformedAt: new Date("2023-04-01"),
    lastPerformedMileage: 47495,
    position: 0,
  },
  {
    name: "Timing belts (cam belts)",
    intervalMonths: 60,
    intervalMileage: 30000,
    notes: "Last replaced 13 June 2022 at New Vernon Coach (46,840 km). Next due ~2027.",
    lastPerformedAt: new Date("2022-06-13"),
    lastPerformedMileage: 46840,
    position: 1,
  },
  {
    name: "Major service",
    intervalMonths: null,
    intervalMileage: 30000,
    notes: "Last completed April 2023 by J. Scuderia (47,495 km). Next due ~77,500 km.",
    lastPerformedAt: new Date("2023-04-01"),
    lastPerformedMileage: 47495,
    position: 2,
  },
  {
    name: "Coolant flush",
    intervalMonths: 36,
    intervalMileage: null,
    notes: "Peak Euro Yellow used 2023.",
    lastPerformedAt: new Date("2023-04-01"),
    lastPerformedMileage: 47495,
    position: 3,
  },
  {
    name: "Brake fluid",
    intervalMonths: 24,
    intervalMileage: null,
    notes: "Flushed 6/13/2022 at New Vernon Coach.",
    lastPerformedAt: new Date("2022-06-13"),
    lastPerformedMileage: 46840,
    position: 4,
  },
  {
    name: "Gearbox oil (transaxle)",
    intervalMonths: null,
    intervalMileage: 30000,
    notes: "Shell 75W-90 — replaced April 2023.",
    lastPerformedAt: new Date("2023-04-01"),
    lastPerformedMileage: 47495,
    position: 5,
  },
  {
    name: "Power steering inspection",
    intervalMonths: 12,
    intervalMileage: null,
    notes: "Hoses replaced April 2023 — known weak point on this chassis.",
    lastPerformedAt: new Date("2023-04-01"),
    lastPerformedMileage: 47495,
    position: 6,
  },
  {
    name: "Spark plugs (×12)",
    intervalMonths: null,
    intervalMileage: 30000,
    notes: "Iridium plugs installed 6/2022 at New Vernon Coach.",
    lastPerformedAt: new Date("2022-06-13"),
    lastPerformedMileage: 46840,
    position: 7,
  },
  {
    name: "Air filters (×2) & cabin filter",
    intervalMonths: 24,
    intervalMileage: 30000,
    notes: "Replaced 6/2022.",
    lastPerformedAt: new Date("2022-06-13"),
    lastPerformedMileage: 46840,
    position: 8,
  },
  {
    name: "Battery",
    intervalMonths: 60,
    intervalMileage: null,
    notes: "Replaced 2021 in Geneva. Plan for replacement around 2026.",
    lastPerformedAt: new Date("2021-06-01"),
    lastPerformedMileage: null,
    position: 9,
  },
  {
    name: "Air-conditioning service",
    intervalMonths: 30,
    intervalMileage: null,
    notes: "Last serviced 2021 (Auto Sport Service, Geneva).",
    lastPerformedAt: new Date("2021-06-01"),
    lastPerformedMileage: null,
    position: 10,
  },
];

const SERVICE_RECORDS = [
  {
    performedAt: new Date("2008-07-01"),
    mileage: 37475,
    shop: "Auto Sport Service, Geneva",
    workSummary: "Anti-pollution test, road readiness inspection.",
  },
  {
    performedAt: new Date("2016-02-01"),
    mileage: 44544,
    shop: "Auto Sport Service, Geneva",
    workSummary:
      "Annual service: handbrake contactor overhaul, timing belt, multi-function belts, coolant, spark plugs (×12), air/oil/pollen filters, anti-pollution test.",
  },
  {
    performedAt: new Date("2017-04-01"),
    mileage: null,
    shop: "Auto Sport Service, Geneva",
    workSummary:
      "Vehicle cleaning, road inspection, radio amplifier fuse replaced, oil top-up, battery recharge.",
  },
  {
    performedAt: new Date("2021-06-01"),
    mileage: 46250,
    shop: "Auto Sport Service, Geneva",
    workSummary:
      "Engine misfire diagnosed (cyl 1 right bank); engine harness rebuilt. Safety inspection, A/C service, battery replaced, Pirelli P-Zero tyres fitted.",
  },
  {
    performedAt: new Date("2022-06-13"),
    mileage: 46840,
    shop: "New Vernon Coach (Morristown, NJ)",
    workSummary:
      "Timing belts & accessory belts replaced, plugs & filters, brake fluid flush, oil & filter, cooling system service.",
    costUsd: 3551.04,
  },
  {
    performedAt: new Date("2023-04-01"),
    mileage: 47495,
    shop: "J. Scuderia Automotive (Cranbury, NJ)",
    workSummary:
      "Major service. Front cover bearing & seals, cam cover gaskets, camshaft seals, water pump, power-steering hoses, suspension shock actuator, second key transponder, interior repairs (ashtrays, headliner).",
    costUsd: 16539.61,
  },
  {
    performedAt: new Date("2026-04-21"),
    mileage: 59000,
    shop: "Sale",
    workSummary: "Acquired from Anthony H. Mulloy, Florham Park NJ.",
    costUsd: 117000,
  },
];

const CONTACTS = [
  {
    name: "J. Scuderia Automotive",
    role: "Specialist (last major service)",
    address: "18 Haypress Rd., Ste 415, Cranbury, NJ 08512",
    phone: "(973) 957-0111",
    website: "https://jscuderiautomotive.com",
    notes: "Service writer of record: Cerise Joseph",
    position: 0,
  },
  {
    name: "New Vernon Coach & Motor Works",
    role: "Specialist (timing-belt service 2022)",
    address: "960 Mount Kemble Avenue, Morristown, NJ 07960",
    phone: "(973) 425-0700",
    website: "https://newvernoncoach.com",
    notes: "Last technician on file: Brett Adair",
    position: 1,
  },
  {
    name: "Auto Sport Service S.A.",
    role: "Specialist (Geneva, 2008–2021 history)",
    address: "Route des Acacias 39-41, 1227 Les Acacias, Geneva",
    phone: "+41 22 342 42 66",
    email: "contact@autosportservice.ch",
    notes: "Maintained the car for over a decade in Europe.",
    position: 2,
  },
  {
    name: "American Modern Property and Casualty",
    role: "Insurer",
    phone: "1-800-543-2644",
    notes: "Policy 105-896-331. Effective 30 April 2026 – 30 April 2027.",
    position: 3,
  },
];

const NOTES = `Cold Starts and Warm-Up
The V12 should be allowed to come up to operating temperature gently. Start the car, let it idle for 30–60 seconds until oil pressure is healthy, then drive away gently for the first 10–15 minutes. Avoid revving past 4,000 rpm until the oil is hot.

The Gated Six-Speed
Cold-shifting into 2nd is the classic 456 quirk — synchros are reluctant until the gearbox oil warms up. For the first few miles, drive 1st → 3rd → 4th → 5th and let 2nd come back to you once it's warm. Never force a shift; the gate will tell you when it's ready.

Tyres and Pressures
Original fitment is 255/45 R17 front and 285/40 R17 rear. Inflate to 32 psi front / 35 psi rear cold for normal road use. Replace if date code is more than 6–7 years old or sidewall cracking visible.

Fuel
Premium unleaded only — 93 octane (US) or 98 RON (Europe) minimum. Avoid letting fuel sit for more than 2–3 months without driving the car or adding a stabiliser.

Storage and Layups
- Park on a battery tender — alarm/ECU draw will flatten a battery in 3–4 weeks.
- Inflate tyres to 40 psi for storage to avoid flat-spotting.
- If laying up for more than 60 days, add fuel stabiliser and run the car.
- Keep a desiccant pack in the cabin — original tan leather, do not let mildew form.

In Case of an Accident or Breakdown
- Move the car to safety only if it is safe to do so — never drive with overheating gauges, oil-pressure warnings, or unusual noise.
- Photograph everything before anything is moved, including the odometer.
- Call the insurer (1-800-543-2644) before authorising any tow.
- Insist on a flatbed — never a hook-and-chain or wheel-lift. The 456 has minimal ground clearance and a long front overhang.
- Have the car towed to J. Scuderia or New Vernon Coach if at all possible.`;

export async function POST() {
  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  // Idempotent: if a vehicle project named the same exists, return it.
  const existing = await prisma.project.findFirst({
    where: { userId, name: PROJECT_NAME, kind: "vehicle" },
    include: { vehicle: true },
  });
  if (existing && existing.vehicle) {
    return NextResponse.json({ projectId: existing.id, alreadyExists: true });
  }

  const maxPosition = await prisma.project.aggregate({ where: { userId }, _max: { position: true } });
  const project = await prisma.project.create({
    data: {
      userId,
      name: PROJECT_NAME,
      kind: "vehicle",
      icon: "Car",
      color: "rose",
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      projectId: project.id,
      userId,
      make: "Ferrari",
      model: "456 GT",
      year: 1995,
      vin: "ZFFSP44S000102410",
      chassisNumber: "102410",
      engineNumber: "40093",
      assemblyNumber: "19687",
      marketSpec: "European version (5.5 L V12, manual)",
      bodyStyle: "2+2 Coupé, Pininfarina design",
      exteriorColor: "Blu Pininfarina (metallic blue)",
      interiorColor: "Tan leather",
      transmission: "6-speed manual, gated shifter, rear transaxle",
      acquiredAt: new Date("2026-04-21"),
      acquiredFrom: "Anthony H. Mulloy, Florham Park NJ",
      acquiredPriceUsd: 117000,
      acquiredMileage: 59000,
      currentMileage: 59000,
      mileageUnit: "km",
      notes: NOTES,
      fluidSpecs: FLUIDS,
      partNumbers: PARTS,
      performanceSpecs: PERFORMANCE,
      insurer: "American Modern Property and Casualty Insurance Company",
      policyNumber: "105-896-331",
      policyEffective: new Date("2026-04-30"),
      policyExpires: new Date("2027-04-30"),
      insurerPhone: "1-800-543-2644",
    },
  });

  await prisma.serviceItem.createMany({
    data: SERVICE_ITEMS.map((s) => ({ ...s, vehicleId: vehicle.id, userId })),
  });
  await prisma.serviceRecord.createMany({
    data: SERVICE_RECORDS.map((r) => ({ ...r, vehicleId: vehicle.id, userId })),
  });
  await prisma.vehicleContact.createMany({
    data: CONTACTS.map((c) => ({ ...c, vehicleId: vehicle.id, userId })),
  });

  return NextResponse.json({ projectId: project.id, alreadyExists: false });
}
