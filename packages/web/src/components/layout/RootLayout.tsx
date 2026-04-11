import { Outlet } from "react-router-dom";
import { Menu, PanelLeft, Globe, Wifi } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ErrorDialog } from "../ErrorDialog";
import { CommandPalette } from "../CommandPalette";
import { ToastProvider } from "../Toast";
import { useAppStore } from "../../stores/appStore";
import { useMobile } from "../../hooks/useMobile";
import { Logo } from "../Logo";

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
        <Logo className="w-6 h-6" />
        Kai
      </div>
      <div className="flex-1" />
      <TailscaleBadge />
    </div>
  );
}

function TailscaleBadge() {
  // Check if we're being served via Tailscale
  const isTailscale = typeof window !== 'undefined' && 
    (window.location.hostname.includes('.ts.net') || 
     window.location.hostname.includes('tailscale'));
  
  if (!isTailscale) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground bg-muted/50 rounded" title="Running locally">
        <Wifi className="w-3 h-3" />
        <span className="hidden sm:inline">Local</span>
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-green-700 bg-green-50 rounded" title={`Accessible via Tailscale: ${window.location.hostname}`}>
      <Globe className="w-3 h-3" />
      <span className="hidden sm:inline">Tailscale</span>
    </div>
  );
}

export function RootLayout() {
  return (
    <ToastProvider>
      {/* Use dvh for proper mobile viewport height, fallback to vh */}
      <div 
        className="flex h-[100dvh] h-screen overflow-hidden bg-background"
        style={{ 
          paddingTop: 'env(safe-area-inset-top)', 
          paddingBottom: 'env(safe-area-inset-bottom)', 
          paddingLeft: 'env(safe-area-inset-left)', 
          paddingRight: 'env(safe-area-inset-right)' 
        }}
      >
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <AppHeader />
          <main className="flex-1 min-w-0 overflow-hidden relative">
            <Outlet />
          </main>
        </div>
        <ErrorDialog />
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}
