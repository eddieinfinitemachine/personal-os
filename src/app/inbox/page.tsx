import { redirect } from "next/navigation";

// Inbox is the To Do list on Home now. Kept so old links and capture results
// saved with this path still land somewhere.
export default function InboxRedirect() {
  redirect("/");
}
