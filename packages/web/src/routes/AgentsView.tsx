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
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Agents</h1>
          <Button
            onClick={() => navigate('/agents/new')}
            variant="default"
          >
            <Plus className="w-4 h-4" />
            New Agent
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
          <div className="text-center py-12">
            <FileCode2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">No agents yet</p>
            <Button
              onClick={() => navigate('/agents/new')}
              variant="default"
            >
              Create your first agent
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
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
      className="border rounded-lg bg-card p-4 hover:border-kai-teal transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">{statusIcon}</div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate">{agent.name}</h3>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs",
                agent.enabled
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-700"
              )}
            >
              {agent.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          
          <p className="text-sm text-muted-foreground truncate mt-1">
            {agent.description || 'No description'}
          </p>
          
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            {agent.schedule && (
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {agent.schedule}
              </span>
            )}
            {agent.lastRun && (
              <span>
                Last run: {new Date(agent.lastRun.startedAt).toLocaleDateString()}
              </span>
            )}
            {agent.steps && (
              <span>{agent.steps.length} steps</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={onToggle}
            variant="ghost"
            size="icon"
            className={agent.enabled ? "text-yellow-600 hover:text-yellow-600 hover:bg-yellow-100" : "text-green-600 hover:text-green-600 hover:bg-green-100"}
            title={agent.enabled ? 'Disable' : 'Enable'}
          >
            {agent.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          
          <Button
            onClick={onRun}
            variant="ghost"
            size="icon"
            className="text-blue-600 hover:text-blue-600 hover:bg-blue-100"
            title="Run now"
          >
            <Play className="w-4 h-4" />
          </Button>
          
          <Button
            onClick={onDelete}
            variant="ghost"
            size="icon"
            className="text-red-600 hover:text-red-600 hover:bg-red-100"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
