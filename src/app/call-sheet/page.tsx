import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { CallSheet } from "@/components/call-sheet";
import { PageHeader } from "@/components/mobile-chrome";

export const dynamic = "force-dynamic";

export default async function CallSheetPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <PageHeader title="Call Sheet" />
      <CallSheet />
    </div>
  );
}
