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
  Edit,
  MessageSquare,
  Sparkles,
  Mail,
  Copy,
  Trash2,
  Brain,
  Target,
  StickyNote,
  Bot,
  Save,
} from 'lucide-react';
import { agentsQueries } from '../api/queries';
import { agentsApi } from '../api/client';
import { NetworkError, TimeoutError } from '../api/client';
import { cn } from '../lib/utils';
import { toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { Agent, ErrorState, Attachment, AgentStep } from '../types/api';
import { WorkflowEditor } from '../components/WorkflowEditor';
import { AIWorkflowCreator } from '../components/AIWorkflowCreator';
import { SmartChatInput } from '../components/SmartChatInput';

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
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(!agent.steps || agent.steps.length === 0);
  const navigate = useNavigate();

  // Convert agent steps to WorkflowEditor format
  const workflowSteps = agent.steps?.map((step, i) => ({
    id: String(i),
    type: step.type as any,
    name: step.name,
    skill: step.skill,
    tool: step.action,
    prompt: step.prompt,
    command: step.command,
    parameters: step.params as any,
  })) || [];

  const workflow = {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    version: '1.0.0',
    steps: workflowSteps,
  };

  const handleSave = async (_updatedWorkflow: any, yamlContent: string) => {
    try {
      await agentsApi.updateWorkflow(agent.id, yamlContent);
      toast.success('Workflow saved');
      setIsEditing(false);
      setIsCreating(false);
      // Refresh the page to show updated steps
      navigate(0);
    } catch (err) {
      toast.error('Failed to save workflow');
    }
  };

  const handleWorkflowGenerated = async (yaml: string, _workflow: any) => {
    try {
      await agentsApi.updateWorkflow(agent.id, yaml);
      toast.success('Workflow created!');
      setIsCreating(false);
      // Refresh to show the new workflow
      navigate(0);
    } catch (err) {
      toast.error('Failed to save workflow');
    }
  };

  // AI Workflow Creation Mode
  if (isCreating) {
    return (
      <div className="h-full">
        <AIWorkflowCreator
          agentName={agent.name}
          agentDescription={agent.description}
          onWorkflowGenerated={handleWorkflowGenerated}
          onCancel={() => setIsCreating(false)}
        />
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Workflow</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => setIsCreating(true)}>
              AI Assist
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto border rounded-lg">
          <WorkflowEditor
            initialWorkflow={workflow}
            onSave={handleSave}
          />
        </div>
      </div>
    );
  }

  if (!agent.steps || agent.steps.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileCode2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">No workflow steps defined</p>
          <Button onClick={() => setIsCreating(true)}>
            <Sparkles className="w-4 h-4 mr-2" />
            Create with AI
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workflow Steps</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsCreating(true)}>
            <Sparkles className="w-4 h-4 mr-2" />
            AI Assist
          </Button>
          <Button variant="outline" onClick={() => setIsEditing(true)}>
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {agent.steps.map((step, i) => (
          <div key={i} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-muted-foreground">{i + 1}</span>
              <div className="flex-1">
                <h3 className="font-medium">{step.name}</h3>
                <p className="text-sm text-muted-foreground">Type: {step.type}</p>
              </div>
              {step.skill && <Badge>Skill: {step.skill}</Badge>}
              {step.action && <Badge>Action: {step.action}</Badge>}
            </div>
          </div>
        ))}
      </div>
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
          <Bot className="w-4 h-4" />
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
  const [emailNotifications, setEmailNotifications] = useState(
    (agent as any).config?.emailNotifications !== false // default true
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await agentsApi.update(agent.id, { 
        schedule: schedule || undefined,
        config: { emailNotifications }
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

      {/* Notifications */}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Mail className="w-4 h-4" />
          Notifications
        </h3>
        
        <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.target.checked)}
            className="w-4 h-4 rounded border-border"
          />
          <div className="flex-1">
            <p className="text-sm font-medium">Email notifications</p>
            <p className="text-xs text-muted-foreground">
              Send email when this agent completes successfully
            </p>
          </div>
        </label>
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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-1 bg-muted rounded text-xs">{children}</span>
  );
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

function AgentChat({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load messages from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(`agent-chat-${agent.id}`);
    if (stored) {
      setMessages(JSON.parse(stored));
    } else {
      // Welcome message
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm ${agent.name}. I can help you understand my workflow, check my history, or answer questions about what I do. What would you like to know?`,
        timestamp: Date.now(),
      }]);
    }
  }, [agent.id, agent.name]);

  // Save messages to localStorage
  useEffect(() => {
    localStorage.setItem(`agent-chat-${agent.id}`, JSON.stringify(messages));
  }, [messages, agent.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (message: string, attachments: Attachment[]) => {
    if (!message && attachments.length === 0) return;
    if (isLoading) return;

    const content = attachments.length > 0 
      ? `${message}\n\n[Attached ${attachments.length} file(s): ${attachments.map(a => a.name).join(', ')}]`
      : message;

    const userMessage: ChatMessage = {
      role: 'user',
      content: content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await agentsApi.chat(agent.id, content, attachments);
      
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      toast.error('Failed to get response from agent');
      // Remove the user message on error
      setMessages(prev => prev.slice(0, -1));
      // Let SmartChatInput handle restoring input/attachments
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      content: `Chat cleared. I'm ${agent.name}. How can I help you?`,
      timestamp: Date.now(),
    }]);
    localStorage.removeItem(`agent-chat-${agent.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Chat with {agent.name}</h2>
          <p className="text-sm text-muted-foreground">
            Ask about my workflow, history, or capabilities
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearChat}>
          Clear Chat
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "flex",
              message.role === 'user' ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-lg px-4 py-3",
                message.role === 'user'
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted border border-border"
              )}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p className="text-xs opacity-50 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted border border-border rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-foreground rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-foreground rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-foreground rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input - Using SmartChatInput component */}
      <SmartChatInput
        onSend={sendMessage}
        isLoading={isLoading}
        placeholder={`Ask ${agent.name} about its workflow, history, or capabilities...`}
        showVoiceInput={true}
        showAttachments={true}
      />
    </div>
  );
}
