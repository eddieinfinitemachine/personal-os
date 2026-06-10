export default function HomeLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 h-8 w-48 skeleton rounded" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4"
          >
            <div className="mb-3 h-5 w-32 skeleton rounded" />
            <div className="space-y-2">
              <div className="h-4 w-full skeleton rounded" />
              <div className="h-4 w-5/6 skeleton rounded" />
              <div className="h-4 w-4/6 skeleton rounded" />
              <div className="h-4 w-3/6 skeleton rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
