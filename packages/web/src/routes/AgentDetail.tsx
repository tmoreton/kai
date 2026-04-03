import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSuspenseQuery } from '@tanstack/react-query';
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
} from 'lucide-react';
import { agentsQueries } from '../api/queries';
import { agentsApi } from '../api/client';
import { NetworkError, TimeoutError } from '../api/client';
import { cn } from '../lib/utils';
import { toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import type { Agent, ErrorState } from '../types/api';
import { WorkflowEditor } from '../components/WorkflowEditor';

export function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'workflows' | 'history' | 'settings'>('workflows');
  const [error, setError] = useState<ErrorState | null>(null);

  const { data, isError, error: queryError } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
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
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/agents')}
            className="p-2 hover:bg-accent rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex-1">
            <h1 className="text-lg font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">{agent.description}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={agent.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => agentsApi.update(agent.id, { enabled: !agent.enabled })}
            >
              {agent.enabled ? 'Enabled' : 'Disabled'}
            </Button>
            <Button size="sm" onClick={() => agentsApi.run(agent.id)}>
              <Play className="w-4 h-4 mr-2" />
              Run Now
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          <TabButton active={activeTab === 'workflows'} onClick={() => setActiveTab('workflows')}>
            <FileCode2 className="w-4 h-4 mr-2" />
            Workflow
          </TabButton>
          <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
            <History className="w-4 h-4 mr-2" />
            History
          </TabButton>
          <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4">
        {activeTab === 'workflows' && <AgentWorkflow agent={agent} />}
        {activeTab === 'history' && <AgentHistory agent={agent} />}
        {activeTab === 'settings' && <AgentSettings agent={agent} />}
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
        active ? "bg-kai-teal text-white" : "text-muted-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

function AgentWorkflow({ agent }: { agent: Agent }) {
  const [isEditing, setIsEditing] = useState(false);
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
      // Refresh the page to show updated steps
      navigate(0);
    } catch (err) {
      toast.error('Failed to save workflow');
    }
  };

  if (isEditing) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Workflow</h2>
          <Button variant="outline" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
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
          <Button onClick={() => setIsEditing(true)}>
            <Edit className="w-4 h-4 mr-2" />
            Create Workflow
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workflow Steps</h2>
        <Button variant="outline" onClick={() => setIsEditing(true)}>
          <Edit className="w-4 h-4 mr-2" />
          Edit
        </Button>
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
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Run History</h2>
      {agent.lastRun ? (
        <div className="border rounded-lg p-4">
          <div className="flex items-center gap-3">
            {agent.lastRun.status === 'completed' ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : agent.lastRun.status === 'failed' ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : (
              <Clock className="w-5 h-5 text-yellow-500" />
            )}
            <div>
              <p className="font-medium">Status: {agent.lastRun.status}</p>
              <p className="text-sm text-muted-foreground">
                {new Date(agent.lastRun.startedAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">No runs yet</p>
      )}
    </div>
  );
}

function AgentSettings({ agent }: { agent: Agent }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Settings</h2>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">Schedule</label>
          <p className="text-muted-foreground">{agent.schedule || 'No schedule'}</p>
        </div>
        <div>
          <label className="text-sm font-medium">Workflow Path</label>
          <p className="text-muted-foreground">{agent.workflow_path}</p>
        </div>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-1 bg-muted rounded text-xs">{children}</span>
  );
}
