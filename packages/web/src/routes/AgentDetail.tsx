import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Settings,
  FileCode2,
  History,
  MessageSquare,
  Copy,
  Trash2,
  Brain,
  Target,
  StickyNote,
  UserCircle,
  Save,
  Loader2,
  Check,
} from 'lucide-react';
import { agentsQueries } from '../api/queries';
import { agentsApi } from '../api/client';
import { NetworkError, TimeoutError } from '../api/client';
import { cn } from '../lib/utils';
import { toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { Agent, ErrorState, AgentStep } from '../types/api';
import { AgentChat } from '../components/AgentChat';
import * as YAML from 'js-yaml';

export function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'chat' | 'workflows' | 'history' | 'memory' | 'settings'>('chat');
  const [error, setError] = useState<ErrorState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_runStatus, setRunStatus] = useState<{ steps: unknown[]; logs: string[] } | null>(null);

  const { data, isError, error: queryError } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
    refetchInterval: isRunning ? 2000 : false, // Poll agents list when running
  });

  useEffect(() => {
    if (isError && queryError && !error) {
      let errorState: ErrorState;
      if (queryError instanceof NetworkError) {
        errorState = { type: 'network', message: 'Unable to connect to the server.', recoverable: true };
      } else if (queryError instanceof TimeoutError) {
        errorState = { type: 'timeout', message: 'Request timed out.', recoverable: true };
      } else {
        errorState = { type: 'unknown', message: 'Failed to load agent data.', recoverable: true };
      }
      setError(errorState);
      toast.error('Failed to load agent', errorState.message);
    }
  }, [isError, queryError, error]);

  const agent = data?.agents.find((a: Agent) => a.id === agentId);

  // Poll for run status when agent is running
  useEffect(() => {
    if (!isRunning || !agent) return;

    const poll = async () => {
      try {
        const output = await agentsApi.getOutput(agent.id);
        if (output?.run?.status !== 'running') {
          setIsRunning(false);
          if (output.run.status === 'completed') {
            toast.success('Agent completed successfully');
          } else if (output.run.status === 'failed') {
            toast.error('Agent failed', output.run.error || 'Unknown error');
          }
        }
        setRunStatus({ steps: output.steps || [], logs: [] });
      } catch (err) {
        console.error('Poll error:', err);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 2000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isRunning, agent?.id]);

  const handleRun = async () => {
    if (!agent) return;
    setIsRunning(true);
    toast.success('Agent started', 'Running workflow...');
    setActiveTab('history');
    
    try {
      await agentsApi.run(agent.id);
    } catch (err) {
      toast.error('Failed to start', err instanceof Error ? err.message : 'Unknown error');
      setIsRunning(false);
    }
  };

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-muted-foreground mb-4">Agent not found</h1>
          <Button onClick={() => navigate('/agents')}>Back to Agents</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/agents')}
              className="p-2 hover:bg-accent rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold truncate">{agent.name}</h1>
                {isRunning && (
                  <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    <span className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                    Running
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{agent.description}</p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant={agent.enabled ? "default" : "outline"}
                size="sm"
                onClick={() => agentsApi.update(agent.id, { enabled: !agent.enabled })}
              >
                {agent.enabled ? 'Enabled' : 'Disabled'}
              </Button>
              <Button 
                size="sm" 
                onClick={handleRun}
                disabled={isRunning}
              >
                {isRunning ? (
                  <>
                    <Clock className="w-4 h-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Run Now
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            <TabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Chat
            </TabButton>
            <TabButton active={activeTab === 'workflows'} onClick={() => setActiveTab('workflows')}>
              <FileCode2 className="w-4 h-4 mr-2" />
              Workflow
            </TabButton>
            <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
              <History className="w-4 h-4 mr-2" />
              History
            </TabButton>
            <TabButton active={activeTab === 'memory'} onClick={() => setActiveTab('memory')}>
              <Brain className="w-4 h-4 mr-2" />
              Memory
            </TabButton>
            <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </TabButton>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-4 sm:px-6 py-4">
          <div className="max-w-4xl mx-auto h-full">
            {activeTab === 'chat' && <AgentChat agent={agent} />}
            {activeTab === 'workflows' && <AgentWorkflow agent={agent} />}
            {activeTab === 'history' && <AgentHistory agent={agent} />}
            {activeTab === 'memory' && <AgentMemory agent={agent} />}
            {activeTab === 'settings' && <AgentSettings agent={agent} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

function AgentWorkflow({ agent }: { agent: Agent }) {
  const [viewMode, setViewMode] = useState<'pretty' | 'yaml'>('pretty');

  if (!agent.steps || agent.steps.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileCode2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">No workflow steps defined</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workflow Steps ({agent.steps.length})</h2>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setViewMode('pretty')}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              viewMode === 'pretty' 
                ? "bg-background text-foreground shadow-sm" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Pretty
          </button>
          <button
            onClick={() => setViewMode('yaml')}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              viewMode === 'yaml' 
                ? "bg-background text-foreground shadow-sm" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            YAML
          </button>
        </div>
      </div>

      {/* Pretty View */}
      {viewMode === 'pretty' && (
        <div className="space-y-3">
          {agent.steps.map((step, i) => (
            <div key={i} className="border rounded-lg p-4 bg-card">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm">{step.name}</h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="secondary">{step.type}</Badge>
                    {step.skill && <Badge variant="outline">Skill: {step.skill}</Badge>}
                    {step.action && <Badge variant="outline">Action: {step.action}</Badge>}
                  </div>
                  {step.prompt && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                      {step.prompt}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* YAML View */}
      {viewMode === 'yaml' && (
        <AgentWorkflowEditor agent={agent} />
      )}
    </div>
  );
}

function AgentWorkflowEditor({ agent }: { agent: Agent }) {
  const [yaml, setYaml] = useState(() => {
    const stepsYaml = agent.steps?.map((step) => {
      const lines = [`- name: ${step.name}`, `  type: ${step.type}`];
      if (step.skill) lines.push(`  skill: ${step.skill}`);
      if (step.action) lines.push(`  action: ${step.action}`);
      if (step.prompt) lines.push(`  prompt: |\n    ${step.prompt.replace(/\n/g, '\n    ')}`);
      if (step.command) lines.push(`  command: ${step.command}`);
      if (step.params && Object.keys(step.params).length > 0) {
        lines.push(`  params:`);
        Object.entries(step.params).forEach(([k, v]) => {
          lines.push(`    ${k}: ${JSON.stringify(v)}`);
        });
      }
      return lines.join('\n');
    }).join('\n') || '';

    // Backend expects flat structure (not nested under 'agent:')
    return `name: "${agent.name.replace(/"/g, '\\"')}"\ndescription: "${(agent.description || '').replace(/"/g, '\\"')}"\nsteps:\n${stepsYaml}`;
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Validate YAML
      const parsed = YAML.load(yaml) as any;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML: must be an object');
      }
      // Support both flat format (name/steps) and nested format (agent.name/agent.steps)
      const hasSteps = (parsed.steps || parsed.agent?.steps) && Array.isArray(parsed.steps || parsed.agent?.steps);
      if (!hasSteps) {
        throw new Error('Invalid YAML: missing steps array');
      }

      // Save to backend
      await agentsApi.updateWorkflow(agent.id, yaml);
      
      toast.success('Workflow saved successfully');
      setIsEditing(false);
      
      // Refresh agent data
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (err: any) {
      setError(err.message || 'Failed to save workflow');
      toast.error('Save failed', err.message || 'Invalid YAML');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header with Edit/Save buttons */}
      <div className="flex items-center justify-between p-3 bg-muted border-b">
        <span className="text-sm font-medium">
          {isEditing ? 'Editing Workflow YAML' : 'Workflow YAML (read-only)'}
        </span>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsEditing(false);
                  setError(null);
                  // Reset to original
                  const stepsYaml = agent.steps?.map((step) => {
                    const lines = [`- name: ${step.name}`, `  type: ${step.type}`];
                    if (step.skill) lines.push(`  skill: ${step.skill}`);
                    if (step.action) lines.push(`  action: ${step.action}`);
                    if (step.prompt) lines.push(`  prompt: |\n    ${step.prompt.replace(/\n/g, '\n    ')}`);
                    if (step.command) lines.push(`  command: ${step.command}`);
                    if (step.params && Object.keys(step.params).length > 0) {
                      lines.push(`  params:`);
                      Object.entries(step.params).forEach(([k, v]) => {
                        lines.push(`    ${k}: ${JSON.stringify(v)}`);
                      });
                    }
                    return lines.join('\n');
                  }).join('\n') || '';
                  setYaml(`name: "${agent.name.replace(/"/g, '\\"')}"\ndescription: "${(agent.description || '').replace(/"/g, '\\"')}"\nsteps:\n${stepsYaml}`);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="gap-1"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <FileCode2 className="w-4 h-4 mr-2" />
              Edit YAML
            </Button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        </div>
      )}

      {/* YAML content */}
      {isEditing ? (
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          className="w-full h-[500px] p-4 text-sm font-mono bg-muted/50 resize-none focus:outline-none focus:ring-0"
          spellCheck={false}
        />
      ) : (
        <pre className="p-4 text-sm bg-muted/50 overflow-x-auto">
          <code className="text-foreground font-mono whitespace-pre">{yaml}</code>
        </pre>
      )}
    </div>
  );
}

function AgentHistory({ agent }: { agent: Agent }) {
  const [runDetails, setRunDetails] = useState<{ steps: AgentStep[] } | null>(null);
  const [logs, setLogs] = useState<Array<{ id: number; level: string; message: string; created_at: string }>>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  // Fetch detailed output when viewing
  useEffect(() => {
    if (!agent.lastRun) return;
    
    const fetchDetails = async () => {
      setLoading(true);
      try {
        const [output, logsData] = await Promise.all([
          agentsApi.getOutput(agent.id),
          agentsApi.getLogs(agent.id, 30)
        ]);
        setRunDetails(output);
        setLogs(logsData as any[] || []);
      } catch (err) {
        console.error('Failed to fetch run details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [agent.id, agent.lastRun?.id]);

  const toggleStep = (index: number) => {
    const newSet = new Set(expandedSteps);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setExpandedSteps(newSet);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  if (!agent.lastRun) {
    return <p className="text-muted-foreground">No runs yet</p>;
  }

  return (
    <div className="space-y-4">
      {/* Run Summary Card */}
      <div className="border rounded-lg p-4 bg-card">
        <div className="flex items-center gap-3">
          {agent.lastRun.status === 'completed' ? (
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          ) : agent.lastRun.status === 'failed' ? (
            <XCircle className="w-6 h-6 text-red-500" />
          ) : (
            <Clock className="w-6 h-6 text-yellow-500" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium">{agent.lastRun.status === 'completed' ? 'Success' : agent.lastRun.status === 'failed' ? 'Failed' : 'In Progress'}</p>
              {loading && <span className="text-xs text-muted-foreground">(loading details...)</span>}
            </div>
            <p className="text-sm text-muted-foreground">
              {new Date(agent.lastRun.startedAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Main Error */}
        {agent.lastRun.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="font-medium text-red-700 text-sm">Run Error:</p>
            <p className="font-mono text-xs text-red-600 break-words mt-1">{agent.lastRun.error}</p>
          </div>
        )}
      </div>

      {/* Step-by-Step Breakdown */}
      {runDetails?.steps && runDetails.steps.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted px-4 py-2">
            <p className="font-medium text-sm">Step-by-Step Execution</p>
          </div>
          <div className="divide-y">
            {runDetails.steps.map((step, i) => (
              <div key={i} className="bg-card">
                <button
                  onClick={() => toggleStep(i)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
                >
                  {getStatusIcon(step.status)}
                  <span className="font-mono text-sm text-muted-foreground w-6">{i + 1}</span>
                  <span className="flex-1 font-medium text-sm">{step.name}</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    step.status === 'completed' && "bg-green-100 text-green-700",
                    step.status === 'failed' && "bg-red-100 text-red-700",
                    step.status === 'running' && "bg-blue-100 text-blue-700"
                  )}>
                    {step.status}
                  </span>
                </button>
                
                {expandedSteps.has(i) && (
                  <div className="px-4 pb-3 pl-14">
                    {/* Step Error */}
                    {step.error && (
                      <div className="p-2 bg-red-50 border border-red-200 rounded text-sm mb-2">
                        <p className="font-medium text-red-700">Error:</p>
                        <p className="font-mono text-xs text-red-600 break-words">{step.error}</p>
                      </div>
                    )}
                    {/* Step Output */}
                    {step.output && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Output:</p>
                        <pre className="p-2 bg-muted rounded text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {step.output.substring(0, 2000)}
                          {step.output.length > 2000 && '\n... (truncated)'}
                        </pre>
                      </div>
                    )}
                    {/* Tokens */}
                    {step.tokensUsed && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Tokens used: {step.tokensUsed.toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Logs */}
      {logs.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted px-4 py-2">
            <p className="font-medium text-sm">Recent Logs</p>
          </div>
          <div className="p-3 bg-black text-white font-mono text-xs max-h-48 overflow-y-auto">
            {logs.slice(-20).map((log) => (
              <div key={log.id} className={cn(
                "py-0.5",
                log.level === 'error' && "text-red-400",
                log.level === 'warn' && "text-yellow-400",
                log.level === 'info' && "text-blue-400",
                log.level === 'debug' && "text-gray-400"
              )}>
                <span className="opacity-50">[{new Date(log.created_at).toLocaleTimeString()}]</span>{' '}
                <span className="uppercase font-bold text-[10px]">{log.level}</span>: {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Details Warning */}
      {!loading && !runDetails?.steps?.length && agent.lastRun.status !== 'running' && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
          Step details not available for this run. The workflow may have been deleted or the run is too old.
        </div>
      )}
    </div>
  );
}

function AgentMemory({ agent }: { agent: Agent }) {
  const queryClient = useQueryClient();

  // Memory stored directly in agent config
  const [memory, setMemory] = useState({
    personality: (agent.config?.personality as string) || '',
    goals: (agent.config?.goals as string) || '',
    scratchpad: (agent.config?.scratchpad as string) || '',
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await agentsApi.update(agent.id, {
        config: {
          ...agent.config,
          personality: memory.personality,
          goals: memory.goals,
          scratchpad: memory.scratchpad,
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
      toast.success('Memory saved', "Agent's memory has been updated");
    },
    onError: (err) => {
      toast.error('Failed to save memory', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  const hasChanges =
    memory.personality !== (agent.config?.personality as string) ||
    memory.goals !== (agent.config?.goals as string) ||
    memory.scratchpad !== (agent.config?.scratchpad as string);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Agent Memory
          </h2>
          <p className="text-sm text-muted-foreground">
            This agent's persistent memory, goals, and working notes
          </p>
        </div>
        <Button
          onClick={() => updateMutation.mutate()}
          disabled={!hasChanges || updateMutation.isPending}
        >
          <Save className="w-4 h-4 mr-2" />
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Personality */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <UserCircle className="w-4 h-4" />
          Personality & Identity
        </label>
        <textarea
          value={memory.personality}
          onChange={(e) => setMemory({ ...memory, personality: e.target.value })}
          className="w-full h-32 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="Who is this agent? Describe their personality, tone, and approach..."
        />
        <p className="text-xs text-muted-foreground">
          How the agent behaves, speaks, and approaches tasks
        </p>
      </div>

      {/* Goals */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Target className="w-4 h-4" />
          Goals
        </label>
        <textarea
          value={memory.goals}
          onChange={(e) => setMemory({ ...memory, goals: e.target.value })}
          className="w-full h-32 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="What is this agent trying to achieve?"
        />
        <p className="text-xs text-muted-foreground">
          The agent's objectives and what it's working toward
        </p>
      </div>

      {/* Scratchpad */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <StickyNote className="w-4 h-4" />
          Working Notes (Scratchpad)
        </label>
        <textarea
          value={memory.scratchpad}
          onChange={(e) => setMemory({ ...memory, scratchpad: e.target.value })}
          className="w-full h-40 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="Working notes, learnings, and context the agent should remember..."
        />
        <p className="text-xs text-muted-foreground">
          Persistent working memory - the agent can update this during runs
        </p>
      </div>
    </div>
  );
}

function AgentSettings({ agent }: { agent: Agent }) {
  const [schedule, setSchedule] = useState(agent.schedule || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await agentsApi.update(agent.id, { 
        schedule: schedule || undefined,
      });
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-6">
      {/* Schedule */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Schedule
        </label>
        <Input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="e.g., 0 9 * * * (cron) or daily at 9am"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Cron expression or natural language (e.g., "daily at 9am", "every 30 minutes")
        </p>
      </div>

      {/* Agent Info */}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <FileCode2 className="w-4 h-4" />
          Agent Info
        </h3>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2 bg-muted rounded">
            <span className="text-xs text-muted-foreground">Agent ID</span>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono">{agent.id}</code>
              <button 
                onClick={() => copyToClipboard(agent.id)}
                className="p-1 hover:bg-accent rounded"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
          
          {agent.workflow_path && (
            <div className="flex items-center justify-between p-2 bg-muted rounded">
              <span className="text-xs text-muted-foreground">Workflow Path</span>
              <code className="text-xs font-mono truncate max-w-[200px]">{agent.workflow_path}</code>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button variant="outline" onClick={() => agentsApi.delete(agent.id).then(() => window.location.href = '/agents')}>
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Agent
        </Button>
      </div>
    </div>
  );
}

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'secondary' | 'outline' }) {
  const variantClasses = {
    default: 'bg-muted',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border bg-transparent',
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs", variantClasses[variant])}>{children}</span>
  );
}

