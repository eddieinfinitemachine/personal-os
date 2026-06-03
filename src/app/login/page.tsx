import { headers } from "next/headers";
import { AuthForm } from "@/components/auth-form";
import { isPrivateHost } from "@/lib/hosts";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Password sign-in is offered only on the private single-operator host.
  const allowPassword = isPrivateHost((await headers()).get("host"));
  return <AuthForm mode="login" allowPassword={allowPassword} />;
}
