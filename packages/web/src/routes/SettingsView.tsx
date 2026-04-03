import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Server, Puzzle, Key, Brain, FileText, Terminal, RotateCcw, AlertCircle } from "lucide-react";
import { settingsQueries } from "../api/queries";
import { ApiError, NetworkError, TimeoutError } from "../api/client";
import { cn } from "../lib/utils";
import { toast } from "../components/Toast";
import { McpSettings } from "./settings/McpSettings";
import { SkillsSettings } from "./settings/SkillsSettings";
import { EnvSettings } from "./settings/EnvSettings";
import { SoulSettings } from "./settings/SoulSettings";
import { ContextSettings } from "./settings/ContextSettings";
import { CliSettings } from "./settings/CliSettings";

type TabType = 'mcp' | 'skills' | 'env' | 'soul' | 'context' | 'cli';

interface SettingsErrorState {
  message: string;
  type: 'error' | 'warning';
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<TabType>('mcp');
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
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl sm:text-2xl font-semibold text-kai-text mb-2">Settings</h1>
        <p className="text-muted-foreground mb-6">
          Configure MCP servers, manage skills, and adjust preferences.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          <TabButton active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} icon={<Server className="w-4 h-4" />}>
            MCP Servers
          </TabButton>
          <TabButton active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} icon={<Puzzle className="w-4 h-4" />}>
            Skills
          </TabButton>
          <TabButton active={activeTab === 'env'} onClick={() => setActiveTab('env')} icon={<Key className="w-4 h-4" />}>
            Environment
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

        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
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
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-kai-text hover:border-border"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
