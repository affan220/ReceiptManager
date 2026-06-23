import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning" | "destructive" | "accent" | "muted";
}

const toneMap: Record<NonNullable<Props["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  accent: "bg-accent/10 text-accent",
  muted: "bg-muted text-muted-foreground",
};

export function StatCard({ label, value, hint, icon: Icon, tone = "primary" }: Props) {
  return (
    <div className="card-surface p-5 flex flex-col gap-3 hover:-translate-y-0.5 transition-transform">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {label}
          </p>
          <p className="mt-1 font-display text-2xl font-bold leading-tight truncate">
            {value}
          </p>
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneMap[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {hint && <p className="text-xs text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}
