"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  "missing-token": "That link was incomplete. Request a new one below.",
  invalid: "That link wasn't valid. Request a new one below.",
  used: "That link was already used. Request a new one to sign in again.",
  expired: "That link expired. Request a new one below.",
};

interface AuthFormProps {
  mode: "signup" | "login";
}

export function AuthForm(props: AuthFormProps) {
  return (
    <Suspense fallback={null}>
      <AuthFormInner {...props} />
    </Suspense>
  );
}

function AuthFormInner({ mode }: AuthFormProps) {
  const search = useSearchParams();
  const errorParam = search.get("error");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam ? ERROR_MESSAGES[errorParam] ?? "Something went wrong. Try again." : null,
  );

  const isSignup = mode === "signup";
  const headline = isSignup ? "Create your account" : "Welcome back";
  const subhead = isSignup
    ? "Enter your email — we'll send you a link to get in. No password to remember."
    : "Enter your email — we'll send you a link to sign in. No password.";
  const buttonLabel = isSignup ? "Send sign-up link" : "Send sign-in link";
  const otherLabel = isSignup ? "Already have an account? Sign in" : "Need an account? Sign up";
  const otherHref = isSignup ? "/login" : "/signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    setError(null);

    // Preserve the invite token if present in the URL.
    const invite = search.get("invite");
    const url = invite ? `/api/auth/request-link?invite=${encodeURIComponent(invite)}` : "/api/auth/request-link";

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }
      setSent(true);
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--color-background)] px-4 text-[var(--color-foreground)]">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 block text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Kaizen
          </div>
        </Link>

        {sent ? (
          <SentState email={email} onChangeEmail={() => setSent(false)} />
        ) : (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6">
            <div className="mb-5 text-center">
              <h1 className="text-xl font-semibold tracking-tight">{headline}</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {subhead}
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <input
                autoFocus
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="min-h-[44px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
              />
              {error ? <div className="text-sm text-rose-500">{error}</div> : null}
              <button
                type="submit"
                disabled={submitting || !email}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md bg-[var(--color-foreground)] px-3 py-2.5 text-sm font-medium text-[var(--color-background)] disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {buttonLabel}
              </button>
            </form>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-[var(--color-muted-foreground)]">
          <Link href={otherHref} className="underline-offset-4 hover:underline">
            {otherLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}

function SentState({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Check your inbox</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        We sent a sign-in link to <span className="font-medium text-[var(--color-foreground)]">{email}</span>.
        It expires in 15 minutes.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        Didn't get it? Check spam, or{" "}
        <button onClick={onChangeEmail} className="underline underline-offset-4">
          use a different email
        </button>
        .
      </p>
    </div>
  );
}
