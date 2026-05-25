export default function PersonalLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8 animate-pulse max-w-2xl">
      <div className="mb-6 h-8 w-40 rounded bg-[var(--color-muted)]" />
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6">
        <div className="space-y-5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-[var(--color-muted)]" />
              <div className="h-9 w-full rounded bg-[var(--color-muted)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
