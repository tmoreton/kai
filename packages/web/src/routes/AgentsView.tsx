import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSuspenseQuery } from "@tanstack/react-query";
import { 
  Plus, 
  Play, 
  Pause,
  FileCode2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { agentsQueries } from "../api/queries";
import { NetworkError, TimeoutError } from "../api/client";
import { toast } from "../components/Toast";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import type { Agent, ErrorState } from "../types/api";

export function AgentsView() {
  const navigate = useNavigate();
  const [error, setError] = useState<ErrorState | null>(null);

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
  });

  if (isError && queryError && !error) {
    let errorState: ErrorState;
    if (queryError instanceof NetworkError) {
      errorState = { type: 'network', message: 'Unable to connect to the server.', recoverable: true };
    } else if (queryError instanceof TimeoutError) {
      errorState = { type: 'timeout', message: 'Request timed out.', recoverable: true };
    } else {
      errorState = { type: 'unknown', message: 'Failed to load agents.', recoverable: true };
    }
    setError(errorState);
    toast.error('Failed to load agents', errorState.message);
  }

  const agents = data?.agents || [];

  const handleToggle = async (_id: string, _enabled: boolean) => {
    toast.info('Toggle not implemented yet');
  };

  const handleRun = async (_id: string) => {
    toast.info('Run not implemented yet');
  };

  const handleDelete = async (_id: string) => {
    if (!confirm('Delete this agent?')) return;
    toast.info('Delete not implemented yet');
  };

  return (
    <div className="h-full overflow-y-auto mobile-scroll-container">
      <div className="max-w-3xl mx-auto p-3 sm:p-4 md:p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground">Agents</h1>
          <Button
            onClick={() => navigate('/agents/new')}
            variant="default"
            size="sm"
            className="sm:size-default"
          >
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">New Agent</span>
          </Button>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
              {error.recoverable && (
                <Button
                  onClick={() => { setError(null); refetch(); }}
                  variant="secondary"
                  size="sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Agents List */}
        {agents.length === 0 ? (
          <div className="text-center py-8 sm:py-12 px-4">
            <FileCode2 className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-4 text-sm sm:text-base">No agents yet</p>
            <Button
              onClick={() => navigate('/agents/new')}
              variant="default"
              size="sm"
              className="sm:size-default"
            >
              Create your first agent
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onToggle={() => handleToggle(agent.id, !agent.enabled)}
                onRun={() => handleRun(agent.id)}
                onDelete={() => handleDelete(agent.id)}
                onClick={() => navigate(`/agents/${agent.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onToggle,
  onRun,
  onDelete,
  onClick,
}: {
  agent: Agent;
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const statusIcon = agent.lastRun?.status === 'completed' ? (
    <CheckCircle2 className="w-5 h-5 text-green-500" />
  ) : agent.lastRun?.status === 'failed' ? (
    <XCircle className="w-5 h-5 text-red-500" />
  ) : agent.lastRun?.status === 'running' ? (
    <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
  ) : (
    <Clock className="w-5 h-5 text-muted-foreground" />
  );

  return (
    <div
      className="border rounded-lg bg-card hover:border-kai-teal transition-colors cursor-pointer w-full overflow-hidden p-3 sm:p-4 mb-3 sm:mb-4"
      onClick={onClick}
    >
      <div className="flex items-start gap-3 sm:gap-4 overflow-hidden">
        <div className="flex-shrink-0 mt-0.5 sm:mt-1">{statusIcon}</div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate text-sm sm:text-base">{agent.name}</h3>
            <span
              className={cn(
                "px-1.5 sm:px-2 py-0.5 rounded-full text-xs flex-shrink-0",
                agent.enabled
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-700"
              )}
            >
              {agent.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          
          <p className="text-xs sm:text-sm text-muted-foreground truncate mt-1">
            {agent.description || 'No description'}
          </p>
          
          <div className="flex items-center gap-2 sm:gap-4 mt-2 text-xs sm:text-sm text-muted-foreground flex-wrap">
            {agent.schedule && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="truncate">{agent.schedule}</span>
              </span>
            )}
            {agent.lastRun && (
              <span className="truncate">
                Last: {new Date(agent.lastRun.startedAt).toLocaleDateString()}
              </span>
            )}
            {agent.steps && (
              <span className="flex-shrink-0">{agent.steps.length} steps</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={onToggle}
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 sm:h-9 sm:w-9 touch-target",
              agent.enabled ? "text-yellow-600 hover:text-yellow-600 hover:bg-yellow-100" : "text-green-600 hover:text-green-600 hover:bg-green-100"
            )}
            title={agent.enabled ? 'Disable' : 'Enable'}
          >
            {agent.enabled ? <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </Button>
          
          <Button
            onClick={onRun}
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9 touch-target text-blue-600 hover:text-blue-600 hover:bg-blue-100"
            title="Run now"
          >
            <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </Button>
          
          <Button
            onClick={onDelete}
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9 touch-target text-red-600 hover:text-red-600 hover:bg-red-100"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
