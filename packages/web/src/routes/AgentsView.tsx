import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Bot,
  Sparkles,
  ChevronRight,
  Search,
  MoreVertical,
} from "lucide-react";
import { agentsQueries } from "../api/queries";
import { agentsApi, NetworkError, TimeoutError } from "../api/client";
import { toast } from "../components/Toast";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { Agent, ErrorState } from "../types/api";

// Agent category icons and colors
const AGENT_CONFIGS: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  'social-media': { 
    icon: <Bot className="w-5 h-5" />, 
    color: "text-blue-600", 
    bg: "bg-blue-50" 
  },
  'email-marketing': { 
    icon: <FileCode2 className="w-5 h-5" />, 
    color: "text-purple-600", 
    bg: "bg-purple-50" 
  },
  'competitor-monitor': { 
    icon: <AlertCircle className="w-5 h-5" />, 
    color: "text-orange-600", 
    bg: "bg-orange-50" 
  },
  'research-assistant': { 
    icon: <Search className="w-5 h-5" />, 
    color: "text-green-600", 
    bg: "bg-green-50" 
  },
  'default': { 
    icon: <Sparkles className="w-5 h-5" />, 
    color: "text-teal-600", 
    bg: "bg-teal-50" 
  },
};

function getAgentConfig(agent: Agent) {
  // Try to match by ID or name
  const key = Object.keys(AGENT_CONFIGS).find(k => 
    agent.id.includes(k) || agent.name.toLowerCase().includes(k.replace('-', ' '))
  );
  return AGENT_CONFIGS[key || 'default'];
}

function formatLastRun(run: Agent['lastRun']): string {
  if (!run) return 'Never run';
  
  const date = new Date(run.startedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getStatusIcon(run: Agent['lastRun']) {
  if (!run) return <Clock className="w-4 h-4 text-muted-foreground" />;
  if (run.status === 'completed') return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (run.status === 'failed') return <XCircle className="w-4 h-4 text-red-500" />;
  if (run.status === 'running') return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
  return <Clock className="w-4 h-4 text-muted-foreground" />;
}

export function AgentsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
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

  // Filter agents by search query
  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      agentsApi.update(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
      toast.success('Agent updated');
    },
    onError: (err) => {
      toast.error('Failed to update agent', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  // Run mutation
  const runMutation = useMutation({
    mutationFn: (id: string) => agentsApi.run(id),
    onSuccess: () => {
      toast.success('Agent run started');
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
    },
    onError: (err) => {
      toast.error('Failed to run agent', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
      toast.success('Agent deleted');
    },
    onError: (err) => {
      toast.error('Failed to delete agent', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  const handleToggle = async (id: string, enabled: boolean) => {
    toggleMutation.mutate({ id, enabled: !enabled });
  };

  const handleRun = async (id: string) => {
    runMutation.mutate(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent? This cannot be undone.')) return;
    deleteMutation.mutate(id);
  };

  const enabledAgents = filteredAgents.filter(a => a.enabled);
  const disabledAgents = filteredAgents.filter(a => !a.enabled);

  return (
    <div className="h-full overflow-y-auto mobile-scroll-container">
      <div className="max-w-4xl mx-auto p-3 sm:p-4 md:p-6 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Your AI Team</h1>
            <p className="text-sm text-muted-foreground">
              {agents.length === 0 
                ? 'Create your first AI agent to automate tasks'
                : `${agents.length} agent${agents.length !== 1 ? 's' : ''} • ${enabledAgents.length} active`
              }
            </p>
          </div>
          <Button
            onClick={() => navigate('/agents/new')}
            variant="default"
            size="sm"
            className="sm:size-default"
          >
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">New Agent</span>
            <span className="sm:hidden">New</span>
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

        {/* Search bar */}
        {agents.length > 0 && (
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="pl-10"
              />
            </div>
          </div>
        )}

        {/* Empty State */}
        {agents.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-teal-500/10 to-teal-600/10 flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-teal-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Create your first AI agent</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Agents work autonomously to check emails, monitor websites, draft content, 
              and handle repetitive tasks — all on your schedule.
            </p>
            <Button
              onClick={() => navigate('/agents/new')}
              variant="default"
              size="lg"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Agent
            </Button>
            
            {/* Template suggestions */}
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
              {[
                { icon: <Bot className="w-5 h-5" />, label: 'Social Media' },
                { icon: <FileCode2 className="w-5 h-5" />, label: 'Content Writer' },
                { icon: <AlertCircle className="w-5 h-5" />, label: 'Monitor' },
                { icon: <Search className="w-5 h-5" />, label: 'Research' },
              ].map((t) => (
                <div 
                  key={t.label}
                  className="p-3 rounded-lg bg-accent/50 text-muted-foreground text-sm flex flex-col items-center gap-2"
                >
                  {t.icon}
                  {t.label}
                </div>
              ))}
            </div>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No agents match "{searchQuery}"</p>
            <Button 
              variant="ghost" 
              onClick={() => setSearchQuery('')}
              className="mt-2"
            >
              Clear search
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active Agents */}
            {enabledAgents.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Active ({enabledAgents.length})
                </h2>
                <div className="space-y-3">
                  {enabledAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      config={getAgentConfig(agent)}
                      onToggle={() => handleToggle(agent.id, agent.enabled)}
                      onRun={() => handleRun(agent.id)}
                      onDelete={() => handleDelete(agent.id)}
                      onClick={() => navigate(`/agents/${agent.id}`)}
                      isToggling={toggleMutation.isPending && toggleMutation.variables?.id === agent.id}
                      isRunning={runMutation.isPending && runMutation.variables === agent.id}
                      isDeleting={deleteMutation.isPending && deleteMutation.variables === agent.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Paused Agents */}
            {disabledAgents.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Paused ({disabledAgents.length})
                </h2>
                <div className="space-y-3">
                  {disabledAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      config={getAgentConfig(agent)}
                      onToggle={() => handleToggle(agent.id, agent.enabled)}
                      onRun={() => handleRun(agent.id)}
                      onDelete={() => handleDelete(agent.id)}
                      onClick={() => navigate(`/agents/${agent.id}`)}
                      isToggling={toggleMutation.isPending && toggleMutation.variables?.id === agent.id}
                      isRunning={runMutation.isPending && runMutation.variables === agent.id}
                      isDeleting={deleteMutation.isPending && deleteMutation.variables === agent.id}
                      dimmed
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Agent Card Component
interface AgentCardProps {
  agent: Agent;
  config: { icon: React.ReactNode; color: string; bg: string };
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
  onClick: () => void;
  isToggling: boolean;
  isRunning: boolean;
  isDeleting: boolean;
  dimmed?: boolean;
}

function AgentCard({ 
  agent, 
  config, 
  onToggle, 
  onRun, 
  onDelete, 
  onClick,
  isToggling,
  isRunning,
  isDeleting,
  dimmed,
}: AgentCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div 
      className={cn(
        "group relative p-4 rounded-xl border transition-all cursor-pointer",
        "hover:shadow-md hover:border-primary/30",
        dimmed 
          ? "bg-muted/30 border-border opacity-75 hover:opacity-100" 
          : "bg-card border-border"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
          config.bg,
          config.color
        )}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-foreground truncate">
                {agent.name}
              </h3>
              {agent.description && (
                <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                  {agent.description}
                </p>
              )}
            </div>
            
            {/* Menu button */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="p-2 rounded-lg hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              
              {showMenu && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-card border rounded-lg shadow-lg z-20 py-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                        setShowMenu(false);
                      }}
                      disabled={isToggling}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
                    >
                      {agent.enabled ? (
                        <>
                          <Pause className="w-4 h-4" />
                          Pause Agent
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          Enable Agent
                        </>
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRun();
                        setShowMenu(false);
                      }}
                      disabled={isRunning || !agent.enabled}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 disabled:opacity-50"
                    >
                      <Play className="w-4 h-4" />
                      Run Now
                    </button>
                    <div className="h-px bg-border my-1" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                        setShowMenu(false);
                      }}
                      disabled={isDeleting}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-accent text-red-600 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Meta info */}
          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              {getStatusIcon(agent.lastRun)}
              <span>{formatLastRun(agent.lastRun)}</span>
            </div>
            
            {agent.schedule && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">{agent.schedule}</span>
              </div>
            )}

            {agent.steps && (
              <div className="text-xs">
                {agent.steps.length} step{agent.steps.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Arrow */}
        <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}
