export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6 md:p-8" aria-busy="true">
      <div className="h-6 w-1/3 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
