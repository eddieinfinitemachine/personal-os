export default function HomeLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 animate-pulse">
      <div className="mb-6 h-8 w-48 rounded bg-[var(--color-muted)]" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          >
            <div className="mb-3 h-5 w-32 rounded bg-[var(--color-muted)]" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-[var(--color-muted)]" />
              <div className="h-4 w-5/6 rounded bg-[var(--color-muted)]" />
              <div className="h-4 w-4/6 rounded bg-[var(--color-muted)]" />
              <div className="h-4 w-3/6 rounded bg-[var(--color-muted)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
