import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ErrorDialog } from "../ErrorDialog";
import { CommandPalette } from "../CommandPalette";
import { ToastProvider } from "../Toast";

export function RootLayout() {
  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">
          <Outlet />
        </main>
        <ErrorDialog />
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}
