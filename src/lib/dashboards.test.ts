import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ vehicleFind: vi.fn(), petFind: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { vehicle: { findUnique: mocks.vehicleFind }, pet: { findUnique: mocks.petFind } },
}));
import { loadVehicleDashboard, vehicleDashboardJson, type VehicleDashboardData } from "./vehicle-dashboard";
import { loadPetDashboard, petDashboardJson, vaccinationStatus, type PetDashboardData } from "./pet-dashboard";

const NOW = new Date("2026-11-08T12:00:00Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

beforeEach(() => vi.clearAllMocks());

describe("vehicle dashboard", () => {
  it("loads the vehicle by project with everything the dashboard shows", async () => {
    mocks.vehicleFind.mockResolvedValue(null);
    expect(await loadVehicleDashboard("p1")).toBeNull();
    const args = mocks.vehicleFind.mock.calls[0][0];
    expect(args.where).toEqual({ projectId: "p1" });
    expect(Object.keys(args.include).sort()).toEqual(
      ["contacts", "drives", "photos", "recommendations", "serviceItems", "serviceRecords", "shoppingItems"],
    );
    expect(args.include.drives).toEqual({ orderBy: { drivenAt: "desc" }, take: 20 });
  });

  it("gives each service item its due status, by time or by distance", () => {
    const vehicle = {
      id: "v1",
      currentMileage: 50_500,
      serviceItems: [
        { id: "oil", intervalMonths: 6, intervalMileage: null, lastPerformedAt: new Date("2026-01-01T00:00:00Z"), lastPerformedMileage: null },
        { id: "tires", intervalMonths: null, intervalMileage: 1_000, lastPerformedAt: null, lastPerformedMileage: 50_000 },
        { id: "never", intervalMonths: 12, intervalMileage: null, lastPerformedAt: null, lastPerformedMileage: null },
      ],
    } as unknown as VehicleDashboardData;
    const json = vehicleDashboardJson(vehicle, NOW);
    expect(json.id).toBe("v1");
    expect(json.serviceItems.map((i) => [i.id, i.due.status])).toEqual([
      ["oil", "overdue"],
      ["tires", "due-soon"],
      ["never", "unknown"],
    ]);
    expect(json.serviceItems[1].due).toMatchObject({ dueMileage: 51_000, milesFromNow: 500 });
  });
});

describe("pet dashboard", () => {
  it("loads the pet by project with everything the dashboard shows", async () => {
    mocks.petFind.mockResolvedValue(null);
    expect(await loadPetDashboard("p2")).toBeNull();
    const args = mocks.petFind.mock.calls[0][0];
    expect(args.where).toEqual({ projectId: "p2" });
    expect(Object.keys(args.include).sort()).toEqual(
      ["photos", "recommendations", "shoppingItems", "vaccinations", "vetVisits", "weights"],
    );
  });

  it("rates a booster overdue, due within 30 days, ok, or unknown without a date", () => {
    expect(vaccinationStatus(daysFromNow(-3), NOW)).toEqual({ status: "overdue", daysFromNow: -3 });
    expect(vaccinationStatus(daysFromNow(30), NOW)).toEqual({ status: "due-soon", daysFromNow: 30 });
    expect(vaccinationStatus(daysFromNow(31), NOW)).toEqual({ status: "ok", daysFromNow: 31 });
    expect(vaccinationStatus(null, NOW)).toEqual({ status: "unknown", daysFromNow: null });
  });

  it("gives each vaccination its booster status", () => {
    const pet = {
      id: "pet1",
      vaccinations: [
        { id: "rabies", boosterDueAt: daysFromNow(10) },
        { id: "fvrcp", boosterDueAt: null },
      ],
    } as unknown as PetDashboardData;
    expect(petDashboardJson(pet, NOW).vaccinations.map((v) => [v.id, v.due.status])).toEqual([
      ["rabies", "due-soon"],
      ["fvrcp", "unknown"],
    ]);
  });
});
