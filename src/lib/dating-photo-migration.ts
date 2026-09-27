import { createHash } from "node:crypto";

export type MigrationPhoto = { id: string; userId: string; personId: string; url: string };
export type PhotoMigrationEntry = Omit<MigrationPhoto, "url"> & {
  sourceUrl: string;
  targetUrl: string;
  sha256: string;
  stage: "copied" | "switched" | "complete";
};
type Dependencies = {
  readSource(photo: MigrationPhoto): Promise<Buffer | null>;
  copyPrivate(photo: MigrationPhoto, bytes: Buffer): Promise<string>;
  readTarget(photo: MigrationPhoto, url: string): Promise<Buffer | null>;
  currentUrl(id: string): Promise<string | null>;
  switchUrl(photo: MigrationPhoto, url: string): Promise<boolean>;
  deleteSource(photo: MigrationPhoto): Promise<void>;
  save(entry: PhotoMigrationEntry): Promise<void>;
};
export const photoDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Copy → verify → durable journal → conditional DB swap → durable journal → delete.
 * No transaction can span Blob and Postgres; the journal makes each gap retryable.
 */
export async function migrateDatingPhoto(photo: MigrationPhoto, existing: PhotoMigrationEntry | undefined, deps: Dependencies) {
  let entry = existing;
  if (entry && (entry.id !== photo.id || entry.userId !== photo.userId || entry.personId !== photo.personId)) {
    throw new Error("Migration manifest ownership mismatch");
  }
  if (entry?.stage === "complete") return;
  if (!entry) {
    const raw = await deps.readSource(photo);
    if (!raw?.length) throw new Error("Source photo could not be read");
    entry = { id: photo.id, userId: photo.userId, personId: photo.personId, sourceUrl: photo.url,
      targetUrl: await deps.copyPrivate(photo, raw), sha256: photoDigest(raw), stage: "copied" };
  }
  const source = { ...photo, url: entry.sourceUrl };
  const copied = await deps.readTarget(source, entry.targetUrl);
  if (!copied || photoDigest(copied) !== entry.sha256) throw new Error("Private copy verification failed");
  // Persist before changing the DB, including on the first attempt.
  if (!existing) await deps.save(entry);
  const current = await deps.currentUrl(photo.id);
  if (current !== entry.targetUrl) {
    if (entry.stage !== "copied" || current !== entry.sourceUrl || !(await deps.switchUrl(source, entry.targetUrl))) {
      throw new Error("Photo changed during migration; source preserved");
    }
  }
  if (entry.stage !== "switched") {
    entry = { ...entry, stage: "switched" };
    await deps.save(entry);
  }
  await deps.deleteSource(source);
  await deps.save({ ...entry, stage: "complete" });
}
