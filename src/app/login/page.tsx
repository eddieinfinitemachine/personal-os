"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") || "/";
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect password.");
        setSubmitting(false);
        return;
      }
      router.replace(from);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-[var(--color-background)]">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-sm">
        <div className="mb-5 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Personal OS
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Enter your password to continue.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[44px]"
          />
          {error ? (
            <div className="text-sm text-rose-500">{error}</div>
          ) : null}
          <button
            type="submit"
            disabled={submitting || !password}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-2.5 text-sm font-medium disabled:opacity-50 min-h-[44px]"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
