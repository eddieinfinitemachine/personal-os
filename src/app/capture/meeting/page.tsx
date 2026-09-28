import { redirect } from "next/navigation";

// Keep old bookmarks useful after retiring the manual meeting importer.
export default function RetiredMeetingImportPage() {
  redirect("/board");
}
