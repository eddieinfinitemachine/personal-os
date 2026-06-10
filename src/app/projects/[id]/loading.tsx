export default function ProjectLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-4 flex items-center gap-3">
        <div className="size-10 rounded-xl bg-[var(--color-muted)]" />
        <div className="h-8 w-64 skeleton rounded" />
      </div>
      <div className="mb-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 skeleton rounded-full"
          />
        ))}
      </div>
      <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-12 w-full rounded-lg bg-[var(--color-muted)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
