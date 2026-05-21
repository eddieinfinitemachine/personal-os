import Link from "next/link";
import {
  Check,
  Circle,
  Search,
  Plus,
  Hash,
  Calendar,
  Users,
  Plane,
  Car,
  TrendingUp,
  Package,
  BookOpen,
  MapPin,
  Sparkles,
  Printer,
  Lock,
  FolderKanban,
  ListTodo,
} from "lucide-react";

export function KaizenLanding() {
  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <Nav />
      <Hero />
      <SocialStrip />
      <CaptureDemo />
      <Surfaces />
      <Inside />
      <Workflow />
      <Closer />
      <Footer />
    </div>
  );
}

/* ───────────────────────── Nav ───────────────────────── */

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-[var(--color-background)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <KaizenMark />
          <span className="text-sm font-semibold tracking-tight">Kaizen</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-[var(--color-muted-foreground)] sm:flex">
          <a href="#capture" className="hover:text-[var(--color-foreground)]">
            Capture
          </a>
          <a href="#inside" className="hover:text-[var(--color-foreground)]">
            Inside
          </a>
          <a href="#workflow" className="hover:text-[var(--color-foreground)]">
            Workflow
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-8 items-center rounded-md bg-[var(--color-foreground)] px-3 text-xs font-medium text-[var(--color-background)] transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

function KaizenMark() {
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] font-display text-[10px]">
      改
    </div>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <BackgroundGlow />
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pb-28">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1 text-[11px] text-[var(--color-muted-foreground)]">
            <Sparkles className="size-3" />
            Quiet AI for the rest of your life
          </div>
          <h1 className="mt-5 text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            A little better,
            <br />
            every day.
          </h1>
          <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-[var(--color-muted-foreground)]">
            Kaizen is the calm operating system for your personal life. One
            place for tasks, projects, people, trips, possessions, and the
            books and ideas you keep returning to.
          </p>
          <p className="mt-3 max-w-xl text-balance text-base leading-relaxed text-[var(--color-muted-foreground)]">
            Type a sentence — anywhere, from any device. It files itself.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--color-foreground)] px-6 text-sm font-medium text-[var(--color-background)] transition-opacity hover:opacity-90"
            >
              Get started — it's free
            </Link>
            <Link
              href="#capture"
              className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--color-border)] px-6 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-card)]"
            >
              See how it works
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[var(--color-muted-foreground)]">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" /> Magic-link, no passwords
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Web, Mac, iOS, Chrome
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Your data, exportable
            </span>
          </div>
        </div>

        {/* Product mockup */}
        <div className="lg:pl-4">
          <AppMockup />
        </div>
      </div>
    </section>
  );
}

function BackgroundGlow() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] opacity-60"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, color-mix(in oklch, var(--color-foreground) 6%, transparent) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent"
      />
    </>
  );
}

/* ───────────────────────── App mockup (Hero) ───────────────────────── */

function AppMockup() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, color-mix(in oklch, var(--color-foreground) 8%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl shadow-black/20">
        {/* Window chrome */}
        <div className="flex h-9 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-card)_92%,var(--color-foreground)_8%)] px-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <div className="ml-3 flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/40 px-2 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">
            <Search className="size-2.5" />
            kaizen.app
          </div>
        </div>
        <div className="grid grid-cols-[160px_1fr]">
          {/* Sidebar */}
          <div className="border-r border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-card)_96%,var(--color-foreground)_4%)] px-2 py-3 text-[11px]">
            <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Lists
            </div>
            <SidebarRow icon={<ListTodo className="size-3" />} label="Today" badge="7" active />
            <SidebarRow icon={<ListTodo className="size-3" />} label="To Do" badge="14" />
            <SidebarRow icon={<ListTodo className="size-3" />} label="Monitor" badge="3" />
            <SidebarRow icon={<ListTodo className="size-3" />} label="Later" badge="22" />
            <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Projects
            </div>
            <SidebarRow icon={<Hash className="size-3" />} label="Home" />
            <SidebarRow icon={<Hash className="size-3" />} label="Studio" />
            <SidebarRow icon={<Hash className="size-3" />} label="Trips" />
            <div className="mb-2 mt-4 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Life
            </div>
            <SidebarRow icon={<Users className="size-3" />} label="Friends" />
            <SidebarRow icon={<BookOpen className="size-3" />} label="Media" />
            <SidebarRow icon={<Package className="size-3" />} label="Inventory" />
          </div>
          {/* Main */}
          <div className="px-5 py-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-base font-semibold tracking-tight">Today</div>
                <div className="text-[11px] text-[var(--color-muted-foreground)]">
                  Thursday, May 21
                </div>
              </div>
              <div className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                7 open
              </div>
            </div>
            <div className="mt-4 space-y-1.5 text-[12px]">
              <TodoLine title="Email landlord about lease renewal" due="Today" />
              <TodoLine title="Pick up dry cleaning" done />
              <TodoLine title="Draft Q3 OKRs" due="Today" tag="Studio" />
              <TodoLine title="Book table at Cafe Mogador" tag="Friends" />
              <TodoLine title="Order new chain for the bike" tag="Inventory" />
              <TodoLine title="Reply to Maya about Lisbon dates" tag="Trips" />
              <TodoLine title="Renew passport" due="Jun 3" />
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">
              <Plus className="size-3" />
              New reminder
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarRow({
  icon,
  label,
  badge,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded px-2 py-1 ${
        active
          ? "bg-[color-mix(in_oklch,var(--color-foreground)_8%,transparent)] text-[var(--color-foreground)]"
          : "text-[var(--color-muted-foreground)]"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      {badge ? <span className="text-[10px] opacity-70">{badge}</span> : null}
    </div>
  );
}

function TodoLine({
  title,
  done,
  due,
  tag,
}: {
  title: string;
  done?: boolean;
  due?: string;
  tag?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      {done ? (
        <Check className="mt-0.5 size-3.5 text-[var(--color-muted-foreground)]" />
      ) : (
        <Circle className="mt-0.5 size-3.5 text-[var(--color-muted-foreground)]" />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={`flex flex-wrap items-baseline gap-x-2 ${
            done ? "text-[var(--color-muted-foreground)] line-through" : ""
          }`}
        >
          <span>{title}</span>
          {due ? (
            <span className="text-[10px] text-[var(--color-muted-foreground)]">{due}</span>
          ) : null}
          {tag ? (
            <span className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {tag}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Social / Principles strip ───────────────────────── */

function SocialStrip() {
  return (
    <section className="border-y border-[var(--color-border)]/60 bg-[color-mix(in_oklch,var(--color-card)_60%,transparent)]">
      <div className="mx-auto grid max-w-6xl gap-y-6 gap-x-10 px-5 py-10 sm:grid-cols-3 sm:px-8">
        <Tenet
          title="Built for one human"
          body="Your account, your data. No team plans, no analytics on you, nothing watching."
        />
        <Tenet
          title="Quiet by default"
          body="No streaks. No reminders that nag. No dashboards. Just the thing you wrote down, where you can find it."
        />
        <Tenet
          title="Every device"
          body="Web, Mac menubar, Chrome extension, iOS share sheet. Same brain, every surface."
        />
      </div>
    </section>
  );
}

function Tenet({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        {body}
      </p>
    </div>
  );
}

/* ───────────────────────── Capture demo ───────────────────────── */

function CaptureDemo() {
  return (
    <section id="capture" className="relative">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Capture
          </div>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            One sentence in. The right home out.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
            Type how you'd talk. An AI classifier reads the sentence, looks up
            anything missing on the web, and routes the result into the right
            table — todo, friend, place, investment, book, trip, anything.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <CommandPaletteMock />
          <div className="space-y-4">
            <ProposalCard
              kind="Trip"
              icon={<Plane className="size-3.5" />}
              title="Lisbon · Oct 4 – 11"
              fields={[
                ["Destination", "Lisbon, Portugal"],
                ["Travellers", "You + 1"],
                ["Status", "Planning"],
              ]}
            />
            <ProposalCard
              kind="Inventory"
              icon={<Package className="size-3.5" />}
              title="Aeron chair · vintage"
              fields={[
                ["Brand", "Herman Miller"],
                ["Paid", "$250"],
                ["Est. value", "$700 – 900"],
              ]}
            />
            <ProposalCard
              kind="Media · To read"
              icon={<BookOpen className="size-3.5" />}
              title="Sapiens"
              fields={[
                ["Author", "Yuval Noah Harari"],
                ["Format", "Book"],
                ["List", "Later · 'Read: Sapiens'"],
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CommandPaletteMock() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-2 -z-10 rounded-2xl"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 30%, color-mix(in oklch, var(--color-foreground) 10%, transparent) 0%, transparent 75%)",
        }}
      />
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl shadow-black/20">
        <div className="flex h-9 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-card)_92%,var(--color-foreground)_8%)] px-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="relative h-[300px] bg-[color-mix(in_oklch,var(--color-card)_70%,var(--color-background)_30%)]">
          {/* Faux blurred app behind */}
          <div className="absolute inset-0 opacity-50 blur-[3px]">
            <div className="grid h-full grid-cols-[140px_1fr]">
              <div className="border-r border-[var(--color-border)]/60 p-3 text-[10px] text-[var(--color-muted-foreground)]">
                <div className="mb-1.5">Today</div>
                <div className="mb-1.5">To Do</div>
                <div className="mb-1.5">Monitor</div>
                <div className="mb-1.5">Later</div>
              </div>
              <div className="space-y-2 p-3 text-[11px] text-[var(--color-muted-foreground)]">
                <div>○ Email landlord about lease</div>
                <div>○ Draft Q3 OKRs</div>
                <div>○ Book table at Cafe Mogador</div>
                <div>○ Renew passport</div>
              </div>
            </div>
          </div>

          {/* Palette */}
          <div className="absolute inset-x-0 top-10 mx-auto w-[88%] max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-xl shadow-black/30">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5 text-[12px]">
              <Search className="size-3.5 text-[var(--color-muted-foreground)]" />
              <span>
                Picked up a vintage Aeron at the flea, $250
                <span className="ml-0.5 inline-block h-3.5 w-[1.5px] translate-y-0.5 animate-pulse bg-[var(--color-foreground)]" />
              </span>
              <kbd className="ml-auto rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-muted-foreground)]">
                ⌘K
              </kbd>
            </div>
            <div className="px-3 py-2.5 text-[11px] text-[var(--color-muted-foreground)]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--color-foreground)]" />
                Parsing · classifying as <span className="text-[var(--color-foreground)]">Inventory</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProposalCard({
  kind,
  icon,
  title,
  fields,
}: {
  kind: string;
  icon: React.ReactNode;
  title: string;
  fields: Array<[string, string]>;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-muted)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {icon}
          {kind}
        </div>
        <div className="text-[10px] text-[var(--color-muted-foreground)]">
          Auto-routed
        </div>
      </div>
      <div className="mt-2 text-sm font-semibold tracking-tight">{title}</div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--color-muted-foreground)]">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ───────────────────────── Surfaces ───────────────────────── */

function Surfaces() {
  return (
    <section className="border-t border-[var(--color-border)]/60">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Anywhere you are
          </div>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The fastest way in, from whatever device is closest.
          </h2>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <SurfaceCard
            title="Command palette"
            shortcut="⌘ K"
            body="From any page. Type, hit Enter, keep working. A drawer slides down when it's ready."
            visual={<PaletteVisual />}
          />
          <SurfaceCard
            title="Mac menu-bar"
            shortcut="⌃ Space"
            body="Native menubar app. Global hotkey opens a tiny composer, even over fullscreen."
            visual={<MenubarVisual />}
          />
          <SurfaceCard
            title="Chrome extension"
            shortcut="⌘ ⇧ J"
            body="Bookmark any article in a keystroke. Title + URL flow into your reading list."
            visual={<ChromeVisual />}
          />
          <SurfaceCard
            title="iOS"
            shortcut="One tap"
            body="Add the Kaizen Shortcut to your Home Screen, Lock Screen, or Action Button for one-tap capture. Or share-sheet any link, selection, or photo from any app."
            visual={<PhoneVisual />}
          />
        </div>
      </div>
    </section>
  );
}

function SurfaceCard({
  title,
  shortcut,
  body,
  visual,
}: {
  title: string;
  shortcut: string;
  body: string;
  visual: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex h-32 items-center justify-center border-b border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-card)_70%,var(--color-background)_30%)]">
        {visual}
      </div>
      <div className="p-4">
        <div className="flex items-baseline gap-2">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]">
            {shortcut}
          </kbd>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {body}
        </p>
      </div>
    </div>
  );
}

function PaletteVisual() {
  return (
    <div className="flex w-44 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-[11px] shadow-md">
      <Search className="size-3 text-[var(--color-muted-foreground)]" />
      <span className="text-[var(--color-muted-foreground)]">Capture…</span>
      <span className="ml-auto inline-flex gap-1">
        <kbd className="rounded border border-[var(--color-border)] px-1 py-0 font-mono text-[9px] text-[var(--color-muted-foreground)]">
          ⌘
        </kbd>
        <kbd className="rounded border border-[var(--color-border)] px-1 py-0 font-mono text-[9px] text-[var(--color-muted-foreground)]">
          K
        </kbd>
      </span>
    </div>
  );
}

function MenubarVisual() {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 shadow-md">
      <KaizenMark />
      <span className="text-[10px] text-[var(--color-muted-foreground)]">Quick Todo</span>
      <span className="ml-1 inline-flex gap-1">
        <kbd className="rounded border border-[var(--color-border)] px-1 py-0 font-mono text-[9px] text-[var(--color-muted-foreground)]">
          ⌃
        </kbd>
        <kbd className="rounded border border-[var(--color-border)] px-1 py-0 font-mono text-[9px] text-[var(--color-muted-foreground)]">
          ␣
        </kbd>
      </span>
    </div>
  );
}

function ChromeVisual() {
  return (
    <div className="w-48 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-md">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1">
        <span className="size-1.5 rounded-full bg-[#ff5f57]" />
        <span className="size-1.5 rounded-full bg-[#febc2e]" />
        <span className="size-1.5 rounded-full bg-[#28c840]" />
        <div className="ml-1 truncate text-[9px] text-[var(--color-muted-foreground)]">
          some-essay.com
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px]">
        <KaizenMark />
        <span>Save to Kaizen</span>
      </div>
    </div>
  );
}

function PhoneVisual() {
  return (
    <div className="flex h-20 w-10 flex-col items-center justify-end rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-md">
      <div className="mb-0.5 size-4 rounded-sm bg-[var(--color-foreground)]/80">
        <div className="grid h-full place-items-center font-display text-[7px] text-[var(--color-background)]">
          改
        </div>
      </div>
      <div className="text-[7px] leading-tight text-[var(--color-muted-foreground)]">
        Share
      </div>
    </div>
  );
}

/* ───────────────────────── Inside ───────────────────────── */

function Inside() {
  return (
    <section id="inside" className="border-t border-[var(--color-border)]/60 bg-[color-mix(in_oklch,var(--color-card)_60%,transparent)]">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Inside
          </div>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Every part of your life, on one keychain.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--color-muted-foreground)]">
            One app instead of twelve. Calm, deliberate, and yours.
          </p>
        </div>

        <div className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={<ListTodo className="size-4" />}
            title="Reminders"
            body="iOS-Reminders feel — lists, subtasks, due dates, drag-to-reorder. Single-click to edit. Double-click for notes + subtasks in a modal."
          />
          <Feature
            icon={<FolderKanban className="size-4" />}
            title="Projects"
            body="Each project gets its own tasks, notes, and files. Captures auto-route to the right one."
          />
          <Feature
            icon={<Users className="size-4" />}
            title="Friends · CRM"
            body="Honest CRM for the people you want to stay close to. Country, role, socials, how you met, full interaction timeline."
          />
          <Feature
            icon={<Plane className="size-4" />}
            title="Trips"
            body="Destinations, dates, lodging, packing, day-by-day items. Drop a sentence about a trip, get a row."
          />
          <Feature
            icon={<Car className="size-4" />}
            title="Vehicles"
            body="Service records, drives, contacts, parts. Snap a receipt and the service entry writes itself."
          />
          <Feature
            icon={<TrendingUp className="size-4" />}
            title="Investments"
            body="Ventures, stocks, crypto, real estate. Round, lead, co-investors, valuation — the AI fills what's public."
          />
          <Feature
            icon={<Package className="size-4" />}
            title="Inventory"
            body="What you own, with current resale values estimated for you. Snap a photo, get brand, model, condition, value."
          />
          <Feature
            icon={<BookOpen className="size-4" />}
            title="Media"
            body="Books, articles, films, shows, podcasts. To read · To watch · To listen · In progress · Consumed."
          />
          <Feature
            icon={<MapPin className="size-4" />}
            title="Places"
            body="Restaurants, hotels, parks. Neighborhood, cuisine, price, hours — looked up automatically."
          />
          <Feature
            icon={<Calendar className="size-4" />}
            title="Best practices"
            body="Habits, routines, principles. Cadence, trigger, why. A library of how you want to live."
          />
          <Feature
            icon={<Printer className="size-4" />}
            title="Daily print"
            body="One paper page each morning — every list, overdue at the top. Pull, not push."
          />
          <Feature
            icon={<Lock className="size-4" />}
            title="Yours"
            body="One account per person. Magic-link auth, no passwords. Export or delete any time."
          />
        </div>
      </div>
    </section>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]">
        {icon}
      </div>
      <div className="mt-3 text-sm font-semibold tracking-tight">{title}</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        {body}
      </p>
    </div>
  );
}

/* ───────────────────────── Workflow ───────────────────────── */

function Workflow() {
  return (
    <section id="workflow" className="border-t border-[var(--color-border)]/60">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Workflow
          </div>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Thought to filed in under two seconds.
          </h2>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          <Step
            n="01"
            title="Speak how you'd speak"
            body='"Dinner with Sam Thursday at 7." "Trip to Lisbon in October." "Bought a vintage chair, $250." No syntax. No fields.'
          />
          <Step
            n="02"
            title="The AI does the work"
            body="Claude classifies the sentence, searches the web if needed (place hours, book authors, public investment data), and assembles a clean proposal."
          />
          <Step
            n="03"
            title="Approve from the drawer"
            body="Pending captures land in a quiet top-anchored drawer. Glance, fix, approve. Or let them auto-approve from the menubar."
          />
        </div>
      </div>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-6">
      <div className="font-mono text-xs text-[var(--color-muted-foreground)]">{n}</div>
      <div className="mt-3 text-base font-semibold tracking-tight">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        {body}
      </p>
    </div>
  );
}

/* ───────────────────────── Closer ───────────────────────── */

function Closer() {
  return (
    <section className="border-t border-[var(--color-border)]/60">
      <div className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 sm:py-32">
        <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          A calmer place
          <br />
          for your life.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-balance text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
          One account, one keychain, the whole of you. Free while it's small.
        </p>
        <div className="mt-9 flex justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--color-foreground)] px-6 text-sm font-medium text-[var(--color-background)] transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--color-border)] px-6 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-card)]"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Footer ───────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)]/60">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-10 text-xs text-[var(--color-muted-foreground)] sm:flex-row sm:items-center sm:px-8">
        <div className="flex items-center gap-2">
          <KaizenMark />
          <span>Kaizen · 改善 · A little better, every day.</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/login" className="hover:text-[var(--color-foreground)]">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-[var(--color-foreground)]">
            Sign up
          </Link>
        </div>
      </div>
    </footer>
  );
}
