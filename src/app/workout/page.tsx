import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkoutStudio } from "@/components/workout/workout-studio";

export const dynamic = "force-dynamic";

export default async function WorkoutPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <WorkoutStudio />;
}
