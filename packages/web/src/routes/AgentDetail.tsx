import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSuspenseQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  MessageSquare,
  GitBranch,
  History,
  Play,
  Plus,
  Loader2,
  AlertCircle,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  Terminal,
  Paperclip
} from 'lucide-react';
import { agentsQueries } from '../api/queries';
import { agentsApi, personasApi, api, streamChat } from '../api/client';
import { NetworkError, TimeoutError } from '../api/client';
import { cn } from '../lib/utils';
import { toast } from '../components/Toast';
import { Button } from '../components/ui/button';
import { VoiceInputButton } from '../components/VoiceInputButton';
import type { Agent, Persona, Message, ErrorState } from '../types/api';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

type Tab = 'chat' | 'workflows' | 'history';

export function AgentDetail() {
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [error, setError] = useState<ErrorState | null>(null);

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
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

  const persona = data?.personas.find((p: Persona) => p.id === personaId);
  const agents = data?.agents.filter((a: Agent) => a.personaId === personaId) || [];

  if (!persona) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">Agent not found</p>
          <Button onClick={() => navigate('/agents')}>Back to Agents</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 sm:px-6 py-3 sm:py-4 space-y-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate('/agents')}
            className="p-2 hover:bg-accent rounded-lg transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>

          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-kai-teal-light flex items-center justify-center text-primary text-lg sm:text-xl font-semibold flex-shrink-0">
            {persona.name.charAt(0).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-kai-text truncate">{persona.name}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground truncate">{persona.role}</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-full sm:w-auto">
          <TabButton
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            icon={<MessageSquare className="w-4 h-4" />}
            label="Chat"
          />
          <TabButton
            active={activeTab === 'workflows'}
            onClick={() => setActiveTab('workflows')}
            icon={<GitBranch className="w-4 h-4" />}
            label="Workflows"
          />
          <TabButton
            active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            icon={<History className="w-4 h-4" />}
            label="History"
          />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700 flex-1 text-sm">{error.message}</p>
            {error.recoverable && (
              <button onClick={() => refetch()} className="text-sm text-red-700 hover:underline">
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <AgentChat persona={persona} />}
        {activeTab === 'workflows' && <AgentWorkflows agents={agents} personaId={personaId!} />}
        {activeTab === 'history' && <AgentHistory agents={agents} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none",
        active
          ? "bg-kai-teal text-white shadow-sm"
          : "text-foreground/70 hover:text-foreground hover:bg-muted-foreground/10"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// =============================================================================
// CHAT TAB
// =============================================================================

function AgentChat({ persona }: { persona: Persona }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Start or join chat session
  useEffect(() => {
    const initChat = async () => {
      try {
        const response = await personasApi.chat(persona.id);
        setSessionId(response.id);
        // Load existing messages if any
        const session = await api.sessions.get(response.id);
        setMessages(session.messages || []);
      } catch (err) {
        toast.error('Failed to start chat', err instanceof Error ? err.message : 'Unknown error');
      }
    };
    initChat();

    return () => {
      abortRef.current?.abort();
    };
  }, [persona.id]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !sessionId || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    abortRef.current = new AbortController();

    try {
      const stream = streamChat(
        { sessionId, message: input },
        abortRef.current.signal
      );

      let assistantContent = '';

      for await (const { event, data } of stream) {
        switch (event) {
          case 'token':
            assistantContent += (data as { text: string }).text;
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: assistantContent }];
              }
              return [...prev, { role: 'assistant', content: assistantContent }];
            });
            break;
          case 'done':
            break;
          case 'error': {
            const errorData = data as { message?: string };
            toast.error('Chat error', errorData.message || 'An error occurred');
            break;
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error('Chat error', err.message);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Start a conversation with {persona.name}</p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div 
              key={i} 
              className={cn(
                "flex gap-3",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              {msg.role !== 'user' && (
                <div className="w-8 h-8 rounded-full bg-kai-teal-light flex items-center justify-center text-primary text-sm font-semibold flex-shrink-0">
                  {persona.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2.5 prose prose-sm",
                msg.role === 'user' 
                  ? "bg-kai-teal text-white prose-invert" 
                  : "bg-card border border-border"
              )}>
                {typeof msg.content === 'string' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <pre className="text-xs overflow-x-auto">{JSON.stringify(msg.content, null, 2)}</pre>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border bg-background p-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-end gap-2 bg-card border border-border rounded-2xl p-2">
            {/* File Attachment */}
            <input
              type="file"
              className="hidden"
              id="agent-file-upload"
            />
            <label
              htmlFor="agent-file-upload"
              className="p-2 rounded-full hover:bg-accent/10 text-muted-foreground hover:text-foreground cursor-pointer flex-shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </label>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${persona.name}...`}
              rows={1}
              className="flex-1 min-h-[44px] max-h-[200px] py-2.5 px-1 bg-transparent border-none outline-none resize-none text-foreground placeholder:text-muted-foreground"
              style={{ lineHeight: '1.5' }}
              disabled={isLoading}
            />

            <VoiceInputButton 
              onTranscript={(text) => setInput(prev => prev + text)}
              disabled={isLoading}
            />
            
            {isLoading ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="p-2 rounded-full bg-red-500 text-white hover:bg-red-600 flex-shrink-0 animate-pulse"
              >
                <Loader2 className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-2 rounded-full bg-kai-teal text-white hover:bg-kai-teal/90 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// WORKFLOWS TAB
// =============================================================================

function AgentWorkflows({ agents, personaId }: { agents: Agent[]; personaId: string }) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agents[0]?.id || null);
  const navigate = useNavigate();

  if (agents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <GitBranch className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">No workflows for this agent yet</p>
          <Button onClick={() => navigate(`/agents/persona/edit/${personaId}`)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Workflow
          </Button>
        </div>
      </div>
    );
  }

  const selectedAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const [showSidebar, setShowSidebar] = useState(false);

  return (
    <div className="h-full flex flex-col sm:flex-row">
      {/* Mobile workflow selector */}
      <div className="sm:hidden border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="flex items-center gap-2 text-sm font-medium text-kai-text"
          >
            <GitBranch className="w-4 h-4" />
            {selectedAgent.name}
            <ArrowLeft className={cn("w-4 h-4 transition-transform", showSidebar ? "rotate-90" : "-rotate-90")} />
          </button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/agents/persona/edit/${personaId}`)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {showSidebar && (
          <div className="mt-2 border-t border-border pt-2 space-y-1">
            {agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => { setSelectedAgentId(agent.id); setShowSidebar(false); }}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  selectedAgentId === agent.id ? "bg-kai-teal/10 text-kai-text font-medium" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {agent.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Workflow List */}
      <div className="hidden sm:block w-64 border-r border-border bg-card overflow-y-auto flex-shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-kai-text">Workflows</h3>
            <p className="text-xs text-muted-foreground mt-1">{agents.length} total</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/agents/persona/edit/${personaId}`)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {agents.map(agent => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            className={cn(
              "w-full text-left px-4 py-3 border-b border-border hover:bg-accent transition-colors",
              selectedAgentId === agent.id && "bg-kai-teal/10 border-l-4 border-l-kai-teal"
            )}
          >
            <div className="font-medium text-sm text-kai-text">{agent.name}</div>
            <div className="text-xs text-muted-foreground truncate">{agent.description}</div>
            <div className="flex items-center gap-2 mt-2">
              <span className={cn(
                "w-2 h-2 rounded-full",
                agent.enabled ? "bg-green-500" : "bg-red-500"
              )} />
              <span className="text-xs text-muted-foreground">
                {agent.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {agent.schedule && (
                <span className="text-xs text-kai-teal">{agent.schedule}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Workflow Editor */}
      <div className="flex-1 overflow-hidden min-h-0">
        <EmbeddedWorkflowEditor agentId={selectedAgent.id} agentName={selectedAgent.name} />
      </div>
    </div>
  );
}

function EmbeddedWorkflowEditor({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [yaml, setYaml] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    loadWorkflow();
  }, [agentId]);

  const loadWorkflow = async () => {
    setIsLoading(true);
    try {
      const response = await agentsApi.getWorkflow(agentId);
      setYaml(response.yaml || getDefaultWorkflow());
    } catch {
      setYaml(getDefaultWorkflow());
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await agentsApi.updateWorkflow(agentId, yaml);
      toast.success('Workflow saved');
    } catch (err) {
      toast.error('Failed to save', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    try {
      await agentsApi.run(agentId);
      toast.success('Workflow started');
    } catch (err) {
      toast.error('Failed to run', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="font-medium text-sm truncate">{agentName}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save
          </Button>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={isRunning}
            className="bg-kai-teal hover:bg-kai-teal/90"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            Run Now
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden bg-[#1e1e1e]">
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          className="w-full h-full p-4 font-mono text-sm text-gray-300 bg-[#1e1e1e] resize-none focus:outline-none"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function getDefaultWorkflow(): string {
  return `# Workflow Definition
# Define automated tasks for this agent

name: "New Workflow"
description: "Describe what this workflow does"
schedule: "0 9 * * *"  # Cron format - runs daily at 9am

steps:
  - name: "Example Step"
    action: "log"
    message: "Hello from workflow"
`;
}

// =============================================================================
// HISTORY TAB
// =============================================================================

function AgentHistory({ agents }: { agents: Agent[] }) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agents[0]?.id || null);
  const { data: agentDetail, isLoading } = useQuery({
    queryKey: ['agent-detail', selectedAgentId],
    queryFn: () => selectedAgentId ? agentsApi.get(selectedAgentId) : Promise.resolve(null),
    enabled: !!selectedAgentId,
  });
  const logs = agentDetail?.runs || [];

  const selectedAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const [showSelector, setShowSelector] = useState(false);

  if (agents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No workflows to show history for
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col sm:flex-row">
      {/* Mobile workflow selector */}
      <div className="sm:hidden border-b border-border bg-card px-4 py-3">
        <button
          onClick={() => setShowSelector(!showSelector)}
          className="flex items-center gap-2 text-sm font-medium text-kai-text w-full"
        >
          <History className="w-4 h-4" />
          {selectedAgent?.name || 'Select Workflow'}
          <ArrowLeft className={cn("w-4 h-4 ml-auto transition-transform", showSelector ? "rotate-90" : "-rotate-90")} />
        </button>
        {showSelector && (
          <div className="mt-2 border-t border-border pt-2 space-y-1">
            {agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => { setSelectedAgentId(agent.id); setShowSelector(false); }}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  selectedAgentId === agent.id ? "bg-kai-teal/10 text-kai-text font-medium" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {agent.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop Agent Selector */}
      <div className="hidden sm:block w-64 border-r border-border bg-card overflow-y-auto flex-shrink-0">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-kai-text">Select Workflow</h3>
        </div>
        {agents.map(agent => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            className={cn(
              "w-full text-left px-4 py-3 border-b border-border hover:bg-accent transition-colors",
              selectedAgentId === agent.id && "bg-kai-teal/10 border-l-4 border-l-kai-teal"
            )}
          >
            <div className="font-medium text-sm text-kai-text">{agent.name}</div>
            <div className="text-xs text-muted-foreground">{agent.schedule || 'Manual only'}</div>
          </button>
        ))}
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <History className="w-12 h-12 mb-3 opacity-50" />
            <p>No run history for {selectedAgent?.name}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(logs as any[]).map((log, i) => (
              <HistoryRow key={i} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ log }: { log: any }) {
  const status = log.status || 'unknown';
  const date = log.startedAt || log.completedAt;
  
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 sm:p-4 bg-card border border-border rounded-lg hover:border-kai-teal transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <StatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-kai-text text-sm">
              {status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status}
            </span>
            <span className="text-xs text-muted-foreground">
              #{log.id?.slice(0, 8) || 'unknown'}{log.trigger ? ` · ${log.trigger}` : ''}
            </span>
          </div>
          {log.error && (
            <p className="text-sm text-red-500 mt-1 truncate">{log.error}</p>
          )}
          {log.recap && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{log.recap}</p>
          )}
        </div>
      </div>

      <div className="text-left sm:text-right text-xs sm:text-sm text-muted-foreground pl-8 sm:pl-0 flex-shrink-0">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {date ? new Date(date).toLocaleString() : 'Unknown time'}
        </div>
        {log.duration && (
          <div className="text-xs">{log.duration}s</div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case 'failed':
      return <XCircle className="w-5 h-5 text-red-500" />;
    case 'running':
      return <Loader2 className="w-5 h-5 text-kai-teal animate-spin" />;
    default:
      return <Terminal className="w-5 h-5 text-muted-foreground" />;
  }
}
