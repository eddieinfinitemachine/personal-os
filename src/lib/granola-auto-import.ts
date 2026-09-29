import type { GranolaFolder } from "@/lib/granola";

// Granola folders whose notes become todos automatically (the
// /api/cron/granola-todos cron, every 30 minutes, no review step). Matched
// against the folder name exactly, ignoring case and surrounding spaces, so
// "GTM Weekly Review", "GTM Daily Standup", "C2-Ben" and "Functional Leads
// Meetings" are NOT included. Everything else still goes through the
// Import Granola button.
export const AUTO_IMPORT_FOLDERS = ["GTM", "C2", "Leads"];

const key = (s: string) => s.trim().toLowerCase();

export function isAutoImportFolder(name: string): boolean {
  return AUTO_IMPORT_FOLDERS.some((f) => key(f) === key(name));
}

/**
 * The auto-import folders, plus any non-matching folders nested under them.
 * Granola's folder_id filter includes child folders, so a "GTM Weekly
 * Review" nested inside "GTM" would otherwise leak in; the cron lists those
 * children's notes and leaves them out. (Today every folder is top-level.)
 */
export function autoImportFolders(folders: GranolaFolder[]): {
  matched: GranolaFolder[];
  excludedChildren: GranolaFolder[];
} {
  const matched = folders.filter((f) => isAutoImportFolder(f.name));
  const byParent = new Map<string, GranolaFolder[]>();
  for (const f of folders) {
    if (!f.parentFolderId) continue;
    byParent.set(f.parentFolderId, [...(byParent.get(f.parentFolderId) ?? []), f]);
  }
  const excluded = new Map<string, GranolaFolder>();
  const walk = (id: string, depth: number) => {
    if (depth > 20) return; // cycle guard
    for (const child of byParent.get(id) ?? []) {
      if (!isAutoImportFolder(child.name)) excluded.set(child.id, child);
      walk(child.id, depth + 1);
    }
  };
  for (const f of matched) walk(f.id, 0);
  return { matched, excludedChildren: [...excluded.values()] };
}
