import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ErrorDialog } from "../ErrorDialog";
import { CommandPalette } from "../CommandPalette";
import { ToastProvider } from "../Toast";
import { useAppStore } from "../../stores/appStore";
import { useMobile } from "../../hooks/useMobile";

function MobileHeader() {
  const { setSidebarOpen } = useAppStore();

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
      <button
        onClick={() => setSidebarOpen(true)}
        className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent/50 text-muted-foreground"
        title="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2 font-bold text-lg text-foreground">
        <svg viewBox="0 0 32 32" className="w-6 h-6">
          <defs>
            <linearGradient id="kai-logo-mobile" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0D9488" />
              <stop offset="100%" stopColor="#115E59" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#kai-logo-mobile)" />
          <path
            d="M9 8v16M9 16l8-8M9 16l8 8"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        Kai
      </div>
    </div>
  );
}

export function RootLayout() {
  const isMobile = useMobile();

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {isMobile && <MobileHeader />}
          <main className="flex-1 min-w-0 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <ErrorDialog />
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}
