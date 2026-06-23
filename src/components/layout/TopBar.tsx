import { Moon, RefreshCw, Settings as SettingsIcon, Sun, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { useApp } from "@/lib/app-context";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface Props {
  title: string;
  subtitle?: string;
  onOpenSidebar?: () => void;
}

export function TopBar({ title, subtitle, onOpenSidebar }: Props) {
  const { theme, toggle } = useTheme();
  const { refresh } = useApp();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenSidebar}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="min-w-0 flex-1">
        <h1 className="font-display text-lg font-bold leading-tight truncate md:text-xl">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground truncate md:text-sm">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            refresh();
            toast.success("Data refreshed");
          }}
          aria-label="Refresh"
        >
          <RefreshCw className="h-[18px] w-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} aria-label="Settings">
          <SettingsIcon className="h-[18px] w-[18px]" />
        </Button>
      </div>
    </header>
  );
}
