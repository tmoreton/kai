import { Outlet } from "react-router-dom";
import { Menu, PanelLeft } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ErrorDialog } from "../ErrorDialog";
import { CommandPalette } from "../CommandPalette";
import { ToastProvider } from "../Toast";
import { useAppStore } from "../../stores/appStore";
import { useMobile } from "../../hooks/useMobile";

function AppHeader() {
  const { sidebarCollapsed, toggleSidebar, setSidebarOpen } = useAppStore();
  const isMobile = useMobile();

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background flex-shrink-0">
      {isMobile ? (
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent/50 text-muted-foreground"
          title="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      ) : sidebarCollapsed ? (
        <button
          onClick={toggleSidebar}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent/50 text-muted-foreground"
          title="Expand sidebar"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      ) : null}
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <svg viewBox="0 0 32 32" className="w-6 h-6">
          <defs>
            <linearGradient id="kai-logo-header" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0D9488" />
              <stop offset="100%" stopColor="#115E59" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#kai-logo-header)" />
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
  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <AppHeader />
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
