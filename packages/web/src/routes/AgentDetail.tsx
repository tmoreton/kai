import { useState, useEffect, useRef } from 'react';
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
  MessageSquare,
  Sparkles,
  Mail,
  Copy,
  Trash2,
} from 'lucide-react';
import { agentsQueries } from '../api/queries';
import { agentsApi } from '../api/client';
import { NetworkError, TimeoutError } from '../api/client';
import { cn } from '../lib/utils';
import { toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { Agent, ErrorState } from '../types/api';
import { WorkflowEditor } from '../components/WorkflowEditor';
import { AIWorkflowCreator } from '../components/AIWorkflowCreator';
import { ChatInput } from '../components/ChatInput';

export function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'chat' | 'workflows' | 'history' | 'settings'>('chat');
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
          <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto p-4 sm:p-6">
          <div className="max-w-4xl mx-auto h-full">
            {activeTab === 'chat' && <AgentChat agent={agent} />}
            {activeTab === 'workflows' && <AgentWorkflow agent={agent} />}
            {activeTab === 'history' && <AgentHistory agent={agent} />}
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
  const [input, setInput] = useState('');
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

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await agentsApi.chat(agent.id, userMessage.content);
      
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

      {/* Input - Using ChatInput component */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSend={sendMessage}
        isLoading={isLoading}
        placeholder={`Ask ${agent.name} about its workflow, history, or capabilities...`}
        showVoiceInput={true}
        showAttachments={false}
      />
    </div>
  );
}
