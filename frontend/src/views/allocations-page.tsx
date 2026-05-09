import Link from "next/link";

export function AllocationsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-10">
      <h1 className="text-foreground text-xl font-semibold">Allocations moved to Prefix pools</h1>
      <p className="text-muted text-sm">
        Individual IP allocations are now managed from each pool prefix detail page.
      </p>
      <Link className="text-accent text-sm font-medium hover:underline" href="/prefixes">
        Open Prefixes
      </Link>
    </div>
  );
}
