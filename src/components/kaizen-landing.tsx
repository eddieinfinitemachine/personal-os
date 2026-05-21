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
          the books you've been meaning to read, the things you own.
        </p>

        <p className="mt-3 max-w-xl text-balance text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
          Not a productivity app. A place to be honest about what you're keeping
          track of, and to leave it a little better than you found it.
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

        {/* Capture surfaces — the distinctive thing */}
        <section className="mt-24">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Capture from anywhere
          </div>
          <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            One sentence in, the right home out.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--color-muted-foreground)]">
            Type a sentence, paste a link, snap a photo. Claude classifies it,
            looks up what it needs to (with web search), and files it where it
            belongs — todo, friend, place, investment, book, trip, anything.
          </p>

          <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            <Surface
              label="⌘K"
              title="Command palette"
              body="From any page. Type, hit Enter, keep working — it parses in the background and slides a drawer down when ready to approve."
            />
            <Surface
              label="⌃Space"
              title="Mac menu-bar app"
              body="Quick Todo lives in your menubar. Hit ⌃Space anywhere, type, done."
            />
            <Surface
              label="⌘⇧J"
              title="Chrome extension"
              body="Bookmark any article in a keystroke. URL + title go straight to your reading list as a media row with a 'Read: …' todo on Later."
            />
            <Surface
              label="iOS"
              title="Shortcut + share sheet"
              body="Share-sheet a URL or selection from any app on your phone — same auto-classify, same destinations."
            />
          </div>

          <p className="mt-6 max-w-xl text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            Example:{" "}
            <span className="italic text-[var(--color-foreground)]">
              &ldquo;Met Sophia Loeb at the Pace opening — Brazilian painter,
              studio in São Paulo, IG @sophialoeb&rdquo;
            </span>{" "}
            → new Person + Interaction row, country and socials filled by Claude,
            tagged as &ldquo;nyc art&rdquo;.
          </p>
        </section>

        {/* Everything you keep */}
        <section className="mt-24">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            What's inside
          </div>
          <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Every section of your life, on one keychain.
          </h2>

          <div className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2">
            <Feature
              title="Reminders"
              body="iOS-Reminders feel — lists, subtasks, due dates, drag-to-reorder. Single-click to edit. Double-click for notes + subtasks in a modal. URLs auto-linkify."
            />
            <Feature
              title="Projects"
              body="Each project has its own tasks, notes, and files. Captures auto-route to the right project (oil filter → Ferrari)."
            />
            <Feature
              title="Friends · CRM"
              body="Honest CRM for people you actually want to stay close to. Country, role, company, social URLs, how you met, interests. Interaction timeline per person. Sort by last seen, overdue, recently added."
            />
            <Feature
              title="Trips"
              body="Destinations, dates, lodging, packing, day-by-day items. Drop in flights and notes; capture &ldquo;Tokyo Jan 5–12 with Maya&rdquo; → trip row."
            />
            <Feature
              title="Vehicles"
              body="Service records, drives, contacts, shopping list per car. Photos, mileage, insurance. Claude can read a receipt and log the service."
            />
            <Feature
              title="Investments"
              body="Ventures, stocks, crypto, real estate. Round, lead, co-investors, valuation — Claude pulls what's public."
            />
            <Feature
              title="Inventory"
              body="The things you own, with current resale values estimated for you. Brand, model, serial, condition. Smart-capture from a photo or a sentence."
            />
            <Feature
              title="Media"
              body="Books, articles, films, shows, podcasts. Split into To read, To watch, To listen, In progress, Consumed. Bookmarks become Media + a &lsquo;Read: …&rsquo; todo on Later."
            />
            <Feature
              title="Places"
              body="Restaurants, hotels, parks. Neighborhood, cuisine, price range, Michelin, hours — Claude looks them up."
            />
            <Feature
              title="Best practices"
              body="Habits, routines, principles. Cadence, trigger, why. The library of things you're trying to live by."
            />
            <Feature
              title="Daily print"
              body="One page — all your lists, overdue at the top — generated server-side. ⌘P each morning if you like starting the day on paper."
            />
            <Feature
              title="Yours"
              body="One account per person, fully scoped data. Magic-link auth, no passwords. Export or delete any time."
            />
          </div>
        </section>

        {/* Tiny footer note */}
        <p className="mt-24 text-xs text-[var(--color-muted-foreground)]">
          Currently invite-only-ish. If you have the link, you're in.
        </p>
      </div>
    </div>
  );
}

function Surface({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]">
          {label}
        </kbd>
        <div className="text-sm font-semibold tracking-tight">{title}</div>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        {body}
      </p>
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
