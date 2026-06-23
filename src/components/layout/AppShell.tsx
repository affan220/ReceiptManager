import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppShell({ title, subtitle, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full w-full bg-background">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0 border-0">
          <Sidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} subtitle={subtitle} onOpenSidebar={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
