import Link from "next/link";

export function IpBlocksPage() {
  return <LegacyPrefixRedirect title="IP Blocks" />;
}

function LegacyPrefixRedirect({title}: {title: string}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-10">
      <h1 className="text-foreground text-xl font-semibold">{title} moved to Prefixes</h1>
      <p className="text-muted text-sm">
        The old IP Blocks model has been merged into the hierarchical Prefix tree.
      </p>
      <Link className="text-accent text-sm font-medium hover:underline" href="/prefixes">
        Open Prefixes
      </Link>
    </div>
  );
}
