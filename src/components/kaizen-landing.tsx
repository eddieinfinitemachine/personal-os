import Link from "next/link";

export function KaizenLanding() {
  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        {/* Mark */}
        <div className="mb-16">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Kaizen
          </div>
          <div className="mt-1 font-display text-2xl tracking-tight opacity-70" aria-hidden>
            改善
          </div>
        </div>

        {/* Hero */}
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          A little better,
          <br />
          every day.
        </h1>

        <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
          Kaizen holds the whole of your life in one calm, deliberate place — the tasks,
          the projects, the people you want to stay close to, the trips you're planning,
          the things you own, the things you've been meaning to read.
        </p>

        <p className="mt-3 max-w-xl text-balance text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
          Not a productivity app. A place to be honest about what you're keeping track of,
          and to leave it a little better than you found it.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/signup"
            className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--color-foreground)] px-6 text-sm font-medium text-[var(--color-background)] transition-opacity hover:opacity-90"
          >
            Sign up — it's free
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--color-border)] px-6 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-card)]"
          >
            Sign in
          </Link>
        </div>

        {/* Features */}
        <div className="mt-20 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          <Feature
            title="Capture"
            body="Todos, ideas, links — in a second. From the browser, the phone, or a global hotkey on the Mac."
          />
          <Feature
            title="Projects"
            body="Each project has its own tasks, notes, and files. Drag work between projects without losing the thread."
          />
          <Feature
            title="People"
            body="A small, honest CRM for the people you actually want to stay close to. When you last saw them, what to follow up on."
          />
          <Feature
            title="Trips"
            body="Flights, lodging, activities, packing — everything for one trip, in one place."
          />
          <Feature
            title="The rest"
            body="Vehicles, investments, inventory, places, best practices. The data of your life, not someone else's spreadsheet."
          />
          <Feature
            title="Yours"
            body="One account per person. Your data is yours; you can export or delete it any time."
          />
        </div>

        {/* Footer note */}
        <p className="mt-20 text-xs text-[var(--color-muted-foreground)]">
          Currently invite-only-ish. If you have the link, you're in.
        </p>
      </div>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        {body}
      </p>
    </div>
  );
}
