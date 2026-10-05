import { Link } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span
        className="flex size-9 items-center justify-center rounded-xl text-primary-foreground"
        style={{ backgroundImage: "var(--gradient-brand)" }}
      >
        <Boxes className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-tight">SkillTrack Labs</span>
        <span className="block text-[11px] text-muted-foreground">{subtitle ?? "Cloud Lab Platform"}</span>
      </span>
    </Link>
  );
}
