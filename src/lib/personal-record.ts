// Type-only definition of the per-user PersonalRecord.data shape.
// The actual values live in the database (model PersonalRecord), never
// in source — see scripts/seed-personal-record.ts for the one-time
// founder backfill.

export type PersonalRecordData = {
  fullName: string;
  birth: {
    date: string; // YYYY-MM-DD
    time: string; // HH:MM
    timezone: string;
    hospital: string;
    borough: string;
    city: string;
    country: string;
    attendant: string;
    attendantAddress?: string;
    birthNumber: string;
    sex: string;
    birthOrder?: string;
    hourMarker: string;
  };
  parents: {
    mother: {
      name: string;
      dob: string;
      birthplace: string;
      residenceAtBirth?: string;
    };
    father: {
      name: string;
      dob: string;
      birthplace: string;
    };
  };
  documents: {
    passport: {
      number: string;
      type?: string;
      country?: string;
      issued: string;
      expires: string;
      authority: string;
    };
  };
};

export async function getPersonalRecord(
  prisma: import("@prisma/client").PrismaClient,
  userId: string,
): Promise<PersonalRecordData | null> {
  const row = await prisma.personalRecord.findUnique({ where: { userId } });
  if (!row) return null;
  return row.data as unknown as PersonalRecordData;
}
