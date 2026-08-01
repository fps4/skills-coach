export default function Loading() {
  return (
    <div className="space-y-4 py-8" aria-busy="true">
      <div className="h-7 w-1/3 animate-pulse rounded bg-line" />
      <div className="h-28 animate-pulse rounded-xl bg-line" />
      <div className="h-28 animate-pulse rounded-xl bg-line" />
    </div>
  );
}
