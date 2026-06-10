export default function CalendarLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-8 w-48 skeleton rounded" />
        <div className="flex gap-2">
          <div className="size-9 skeleton rounded" />
          <div className="size-9 skeleton rounded" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-4 skeleton rounded" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square skeleton rounded"
          />
        ))}
      </div>
    </div>
  );
}
