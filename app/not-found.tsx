import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brackets } from "@/components/corners";

export default function NotFound() {
  return (
    <div className="container flex flex-col items-center py-32 text-center">
      <div className="relative flex w-full max-w-md flex-col items-center gap-5 border border-border bg-card px-8 py-12">
        <Brackets />
        <p className="label-mono tracking-[0.2em] text-synapse">/ Signal lost</p>
        <p className="cursor font-display text-7xl font-medium tracking-tight text-foreground">404</p>
        <p className="max-w-sm text-sm text-muted-foreground">No synapse here — the page you asked for does not exist in the registry.</p>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/explore">Explore registry</Link>
          </Button>
          <Button asChild variant="mono">
            <Link href="/">Overview</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
