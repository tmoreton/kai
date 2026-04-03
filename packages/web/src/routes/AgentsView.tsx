import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSuspenseQuery } from "@tanstack/react-query";
import { 
  Plus, 
  Users, 
  ChevronRight, 
  Edit, 
  AlertCircle, 
  RefreshCw, 
  FileCode, 
  Play, 
  Terminal, 
  Bot, 
  Code, 
  CheckCircle, 
  Clock,
  Cpu,
  Bell,
  Eye,
  Layers,
  X
} from "lucide-react";
import { agentsQueries } from "../api/queries";
import { NetworkError, TimeoutError } from "../api/client";
import { toast } from "../components/Toast";
import { cn } from "../lib/utils";
import type { Agent, Persona, ErrorState, WorkflowStep } from "../types/api";

export function AgentsView() {
  const { personaId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<ErrorState | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
  });

  // Handle errors
  useEffect(() => {
    if (isError && queryError && !error) {
      let errorState: ErrorState;

      if (queryError instanceof NetworkError) {
        errorState = {
          type: 'network',
          message: 'Unable to connect to the server. Please check your connection.',
          recoverable: true,
        };
      } else if (queryError instanceof TimeoutError) {
        errorState = {
          type: 'timeout',
          message: 'Request timed out. The server may be busy.',
          recoverable: true,
        };
      } else if (queryError instanceof Error && queryError.message?.includes('404')) {
        errorState = {
          type: 'server',
          message: 'Agent data not found.',
          recoverable: false,
        };
      } else {
        errorState = {
          type: 'unknown',
          message: 'Failed to load agents. Please try again.',
          recoverable: true,
        };
      }

      setError(errorState);
      toast.error('Failed to load agents', errorState.message, 10000);
    }
  }, [isError, queryError, error]);

  const handleRetry = async () => {
    setError(null);
    setRetryCount(c => c + 1);
    
    try {
      await refetch();
      toast.success('Agents loaded', 'Successfully reconnected to the server');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      setError({
        type: 'unknown',
        message: 'Still unable to load agents. Please try again later.',
        recoverable: true,
      });
      toast.error('Retry failed', message, 8000);
    }
  };

  // Error state UI
  if (error && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-kai-text">Agents</h1>
              <p className="text-muted-foreground mt-1">Manage personas and automated workflows</p>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-16 px-6 bg-card border border-border rounded-xl">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-kai-text mb-2">
              {error.type === 'network' ? 'Connection Error' : 
               error.type === 'timeout' ? 'Request Timeout' : 'Failed to Load'}
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md text-center">
              {error.message}
            </p>
            {error.recoverable && (
              <button
                onClick={handleRetry}
                disabled={retryCount > 3}
                className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${retryCount > 0 ? 'animate-spin' : ''}`} />
                {retryCount > 0 ? 'Retrying...' : 'Try Again'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { personas } = data || { personas: [] };

  if (personaId) {
    return <PersonaDetail personaId={personaId} />;
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-kai-text">Agents</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage personas and automated workflows</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/agents/persona/new')}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-kai-text text-white rounded-lg hover:bg-primary/90 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Persona</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
              {error.recoverable && (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {personas.map((persona: Persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              onClick={() => navigate(`/agents/${persona.id}`)}
            />
          ))}
          {personas.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p>No personas yet. Create your first one!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonaCard({
  persona,
  onClick,
}: {
  persona: Persona;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-card border border-border rounded-xl p-5 hover:border-primary hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-kai-teal-light flex items-center justify-center text-primary text-xl font-semibold flex-shrink-0">
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-kai-text truncate">{persona.name}</h3>
          <p className="text-sm text-muted-foreground truncate">{persona.role}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
        {persona.personality?.slice(0, 120)}...
      </p>
      <div className="flex items-center justify-end text-sm">
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </button>
  );
}

// Step type icon mapping
const StepTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  llm: Bot,
  skill: Cpu,
  integration: Layers,
  shell: Terminal,
  notify: Bell,
  review: Eye,
  approval: CheckCircle,
  parallel: Layers,
};

const StepTypeColors: Record<string, string> = {
  llm: 'bg-blue-100 text-blue-700 border-blue-200',
  skill: 'bg-purple-100 text-purple-700 border-purple-200',
  integration: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  shell: 'bg-orange-100 text-orange-700 border-orange-200',
  notify: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  review: 'bg-teal-100 text-teal-700 border-teal-200',
  approval: 'bg-green-100 text-green-700 border-green-200',
  parallel: 'bg-gray-100 text-gray-700 border-gray-200',
};

function StepTypeBadge({ type }: { type: string }) {
  const Icon = StepTypeIcons[type] || Code;
  const colorClass = StepTypeColors[type] || 'bg-gray-100 text-gray-700 border-gray-200';
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border",
      colorClass
    )}>
      <Icon className="w-3 h-3" />
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}

function WorkflowStepItem({ step, index }: { step: WorkflowStep; index: number }) {
  return (
    <div className="relative flex items-start gap-3 py-3">
      {/* Connector line */}
      {index > 0 && (
        <div className="absolute left-4 -top-2 w-px h-4 bg-border" />
      )}
      
      {/* Step number/badge */}
      <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
        {index + 1}
      </div>
      
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-kai-text">{step.name}</span>
          <StepTypeBadge type={step.type} />
          {step.condition && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              if: {step.condition}
            </span>
          )}
        </div>
        
        {step.skill && (
          <p className="text-xs text-muted-foreground">
            Skill: <span className="text-purple-600 font-medium">{step.skill}</span>
            {step.action && <span className="text-muted-foreground"> → {step.action}</span>}
          </p>
        )}
        
        {step.command && (
          <p className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded truncate">
            {step.command.slice(0, 60)}{step.command.length > 60 ? '...' : ''}
          </p>
        )}
        
        {step.prompt && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {step.prompt.slice(0, 100)}{step.prompt.length > 100 ? '...' : ''}
          </p>
        )}
        
        {step.output_var && (
          <p className="text-xs text-muted-foreground">
            Output: <code className="text-xs bg-muted px-1 py-0.5 rounded">{step.output_var}</code>
          </p>
        )}
      </div>
    </div>
  );
}

function WorkflowYamlModal({ 
  isOpen, 
  onClose, 
  yaml, 
  agentName 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  yaml: string; 
  agentName: string;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="relative w-full max-w-3xl max-h-[80vh] bg-card border border-border rounded-xl shadow-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-kai-teal" />
            <h3 className="font-semibold text-kai-text">Workflow YAML: {agentName}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono text-muted-foreground whitespace-pre-wrap bg-muted/50 p-4 rounded-lg">
            {yaml}
          </pre>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={() => {
              navigator.clipboard.writeText(yaml);
              toast.success('Copied to clipboard');
            }}
            className="px-3 py-1.5 text-sm font-medium bg-kai-teal text-white rounded-lg hover:bg-primary/90"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-kai-text"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentWorkflowCard({ 
  agent, 
  onRun 
}: { 
  agent: Agent; 
  onRun: (id: string) => void;
}) {
  const [showYaml, setShowYaml] = useState(false);
  const [yamlContent, setYamlContent] = useState<string>('');
  const [isLoadingYaml, setIsLoadingYaml] = useState(false);

  const handleViewYaml = async () => {
    if (!agent.id) return;
    setIsLoadingYaml(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/workflow`);
      if (response.ok) {
        const data = await response.json();
        setYamlContent(data.yaml || 'No workflow YAML found');
        setShowYaml(true);
      } else {
        toast.error('Failed to load workflow YAML');
      }
    } catch (err) {
      toast.error('Error loading workflow');
    } finally {
      setIsLoadingYaml(false);
    }
  };

  return (
    <>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Agent Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-2.5 h-2.5 rounded-full",
                agent.enabled ? "bg-green-500" : "bg-kai-text-muted"
              )} />
              <div>
                <h4 className="font-medium text-kai-text">{agent.name}</h4>
                {agent.description && (
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {agent.schedule && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {agent.schedule}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Workflow Steps */}
        <div className="px-4 py-2">
          {agent.steps && agent.steps.length > 0 ? (
            <div className="divide-y divide-border/50">
              {agent.steps.map((step, index) => (
                <WorkflowStepItem key={`${step.name}-${index}`} step={step} index={index} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No workflow steps configured</p>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 bg-muted/30 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleViewYaml}
              disabled={isLoadingYaml}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-kai-text hover:bg-muted rounded-lg transition-colors"
            >
              <FileCode className="w-3.5 h-3.5" />
              {isLoadingYaml ? 'Loading...' : 'View YAML'}
            </button>
            {agent.workflow_path && (
              <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                {agent.workflow_path.split('/').pop()}
              </span>
            )}
          </div>
          <button
            onClick={() => onRun(agent.id)}
            disabled={!agent.enabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-kai-teal text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" />
            Run Now
          </button>
        </div>
      </div>

      <WorkflowYamlModal
        isOpen={showYaml}
        onClose={() => setShowYaml(false)}
        yaml={yamlContent}
        agentName={agent.name}
      />
    </>
  );
}

function PersonaDetail({ personaId }: { personaId: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<ErrorState | null>(null);

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
  });

  useEffect(() => {
    if (isError && queryError && !error) {
      const errorState: ErrorState = {
        type: 'unknown',
        message: queryError instanceof Error ? queryError.message : 'Failed to load persona',
        recoverable: true,
      };
      setError(errorState);
      toast.error('Failed to load persona', errorState.message);
    }
  }, [isError, queryError, error]);

  const persona = data?.personas.find((p: Persona) => p.id === personaId);
  const agents = data?.agents.filter((a: Agent) => a.personaId === personaId) || [];

  if (!persona) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">Persona not found</p>
          <button
            onClick={() => navigate('/agents')}
            className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  const handleRetry = async () => {
    setError(null);
    try {
      await refetch();
      toast.success('Data refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      toast.error('Retry failed', message);
    }
  };

  const handleRunAgent = async (agentId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/run`, { method: 'POST' });
      if (response.ok) {
        toast.success('Agent started', 'The workflow is now running');
      } else {
        toast.error('Failed to start agent');
      }
    } catch (err) {
      toast.error('Error starting agent');
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <button
          onClick={() => navigate('/agents')}
          className="text-sm text-muted-foreground hover:text-primary mb-4"
        >
          ← Back to Agents
        </button>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
              {error.recoverable && (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-start gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-kai-teal-light flex items-center justify-center text-primary text-2xl font-semibold">
            {persona.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-kai-text">{persona.name}</h1>
            <p className="text-muted-foreground">{persona.role}</p>
          </div>
          <button
            onClick={() => navigate(`/agents/persona/edit/${personaId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edit
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-kai-text mb-3">Personality</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{persona.personality}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-kai-text mb-3">Goals</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{persona.goals || 'No goals set'}</p>
          </div>
        </div>

        {/* Agents with Workflows */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-kai-text">
              Skill-Based Workflows ({agents.length})
            </h3>
            {agents.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Each workflow consists of skill-based steps
              </p>
            )}
          </div>
          
          {agents.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <Bot className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No workflows assigned to this persona.</p>
              <p className="text-sm text-muted-foreground">
                Workflows are defined as YAML files with skill-based steps (llm, shell, skill, notify, approval).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {agents.map((agent: Agent) => (
                <AgentWorkflowCard 
                  key={agent.id} 
                  agent={agent} 
                  onRun={handleRunAgent}
                />
              ))}
            </div>
          )}
        </div>

        {/* Workflow Documentation */}
        <div className="mt-8 bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-kai-text mb-4 flex items-center gap-2">
            <Code className="w-4 h-4" />
            Workflow Step Types
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { type: 'llm', icon: Bot, desc: 'LLM call with prompt' },
              { type: 'skill', icon: Cpu, desc: 'Skill integration' },
              { type: 'shell', icon: Terminal, desc: 'Shell command' },
              { type: 'approval', icon: CheckCircle, desc: 'Human approval' },
            ].map(({ type, icon: Icon, desc }) => (
              <div key={type} className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                <Icon className="w-4 h-4 text-kai-teal flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-kai-text">{type}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
