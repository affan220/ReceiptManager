import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppShell({ title, subtitle, children }: Props) {
  const isMobile = useIsMobile();
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const sidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;

  const toggleSidebar = () => {
    if (isMobile) {
      setMobileSidebarOpen((value) => !value);
      return;
    }
    setDesktopSidebarOpen((value) => !value);
  };

  return (
    <div className="flex h-full w-full bg-background overflow-x-hidden">
      {!isMobile && (
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-30 hidden md:block w-64 transform bg-gradient-sidebar transition-transform duration-300 ease-out",
            desktopSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar onToggle={() => setDesktopSidebarOpen(false)} />
        </div>
      )}

      {isMobile && (
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="w-64 p-0 border-0">
            <Sidebar onNavigate={() => setMobileSidebarOpen(false)} onToggle={() => setMobileSidebarOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding-left] duration-300 ease-out",
          !isMobile && desktopSidebarOpen ? "md:pl-64" : "md:pl-0",
        )}
      >
        <TopBar title={title} subtitle={subtitle} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
