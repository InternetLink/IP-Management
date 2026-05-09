import Link from "next/link";

export function SubnetsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-10">
      <h1 className="text-foreground text-xl font-semibold">Subnets moved to Prefixes</h1>
      <p className="text-muted text-sm">
        Subnets are now represented as child prefixes in the Prefix tree.
      </p>
      <Link className="text-accent text-sm font-medium hover:underline" href="/prefixes">
        Open Prefixes
      </Link>
    </div>
  );
}
