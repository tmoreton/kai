import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Server, Puzzle, Key, Brain, FileText, Terminal, RotateCcw, AlertCircle } from "lucide-react";
import { settingsQueries } from "../api/queries";
import { ApiError, NetworkError, TimeoutError } from "../api/client";
import { cn } from "../lib/utils";
import { toast } from "../components/Toast";
import { Button } from "../components/ui/button";
import { McpSettings } from "./settings/McpSettings";
import { SkillsSettings } from "./settings/SkillsSettings";
import { EnvSettings } from "./settings/EnvSettings";
import { SoulSettings } from "./settings/SoulSettings";
import { ContextSettings } from "./settings/ContextSettings";
import { CliSettings } from "./settings/CliSettings";

type TabType = 'skills' | 'mcp' | 'env' | 'soul' | 'context' | 'cli';

interface SettingsErrorState {
  message: string;
  type: 'error' | 'warning';
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<TabType>('skills');
  const [error, setError] = useState<SettingsErrorState | null>(null);

  const { isError, error: queryError, refetch } = useSuspenseQuery({
    ...settingsQueries.list(),
    retry: 2,
  });

  if (isError && queryError && !error) {
    let errorMessage = 'Failed to load settings';
    if (queryError instanceof NetworkError) {
      errorMessage = 'Unable to connect to server. Please check your connection.';
    } else if (queryError instanceof TimeoutError) {
      errorMessage = 'Settings load timed out. Please try again.';
    } else if (queryError instanceof ApiError) {
      errorMessage = queryError.message;
    }
    setError({ message: errorMessage, type: 'error' });
    toast.error('Settings Error', errorMessage, 10000);
  }

  const handleRetry = async () => {
    setError(null);
    try {
      await refetch();
      toast.success('Settings loaded', 'Successfully reconnected');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      setError({ message, type: 'error' });
      toast.error('Retry failed', message);
    }
  };

  return (
    <div className="h-full overflow-y-auto mobile-scroll-container p-3 sm:p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground mb-1">Settings</h1>
        <p className="text-muted-foreground mb-4 sm:mb-6 text-sm sm:text-base">
          Configure MCP servers, manage skills, and adjust preferences.
        </p>

        {error && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1 text-sm">{error.message}</p>
              <Button
                onClick={handleRetry}
                variant="secondary"
                size="sm"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-border mb-4 sm:mb-6 overflow-x-auto scrollbar-hide">
          <TabButton active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} icon={<Puzzle className="w-4 h-4" />}>
            <span className="hidden sm:inline">Skills</span>
          </TabButton>
          <TabButton active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} icon={<Server className="w-4 h-4" />}>
            <span className="hidden sm:inline">MCP Servers</span>
            <span className="sm:hidden">MCP</span>
          </TabButton>
          <TabButton active={activeTab === 'env'} onClick={() => setActiveTab('env')} icon={<Key className="w-4 h-4" />}>
            <span className="hidden sm:inline">Environment</span>
            <span className="sm:hidden">Env</span>
          </TabButton>
          <TabButton active={activeTab === 'soul'} onClick={() => setActiveTab('soul')} icon={<Brain className="w-4 h-4" />}>
            Soul
          </TabButton>
          <TabButton active={activeTab === 'context'} onClick={() => setActiveTab('context')} icon={<FileText className="w-4 h-4" />}>
            Context
          </TabButton>
          <TabButton active={activeTab === 'cli'} onClick={() => setActiveTab('cli')} icon={<Terminal className="w-4 h-4" />}>
            CLI
          </TabButton>
        </div>

        <div className="bg-card border border-border rounded-xl p-3 sm:p-4 md:p-6">
          {activeTab === 'mcp' && <McpSettings />}
          {activeTab === 'skills' && <SkillsSettings />}
          {activeTab === 'env' && <EnvSettings />}
          {activeTab === 'soul' && <SoulSettings />}
          {activeTab === 'context' && <ContextSettings />}
          {activeTab === 'cli' && <CliSettings />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="sm"
      className={cn(
        "flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap rounded-none flex-shrink-0 touch-target",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      {icon}
      {children}
    </Button>
  );
}
