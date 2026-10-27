export default function ProjectsLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-5 flex items-center justify-between">
        <div className="h-8 w-40 skeleton rounded" />
        <div className="h-8 w-28 skeleton rounded" />
      </div>
      <div className="mb-3 h-4 w-32 skeleton rounded" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 skeleton rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
