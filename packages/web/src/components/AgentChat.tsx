import { useState, useRef, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw, Brain } from 'lucide-react';
import { agentsApi, NetworkError, TimeoutError } from '../api/client';
import { useAppStore } from '../stores/appStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolCard } from './ToolCard';
import { SmartChatInput } from './SmartChatInput';
import { toast } from './Toast';
import { Button } from './ui/button';
import type { 
  Agent, 
  Message, 
  ToolCallWithStatus, 
  ToolCallEvent, 
  ToolResultEvent, 
  ThinkingEvent, 
  TokenEvent, 
  ErrorState, 
  Attachment 
} from '../types/api';

interface MessageWithTools extends Message {
  toolCalls?: ToolCallWithStatus[];
}

interface AgentChatProps {
  agent: Agent;
}

export function AgentChat({ agent }: AgentChatProps) {
  const { isStreaming, startStreaming, stopStreaming } = useAppStore();
  const [messages, setMessages] = useState<MessageWithTools[]>(() => {
    // Load messages from localStorage
    const stored = localStorage.getItem(`agent-chat-${agent.id}`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Invalid stored data
      }
    }
    // Welcome message
    return [{
      role: 'assistant',
      content: `Hi! I'm ${agent.name}. I can help you understand my workflow, check my history, or answer questions about what I do. I also have access to all the same tools and skills as the main chat. What would you like to know?`,
    }];
  });
  const [isThinking, setIsThinking] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<Record<string, ToolCallWithStatus>>({});
  const [error, setError] = useState<ErrorState | null>(null);
  const [hasInitiallyScrolled, setHasInitiallyScrolled] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const smartInputRef = useRef<import('./SmartChatInput').SmartChatInputRef>(null);

  // Save messages to localStorage
  useEffect(() => {
    localStorage.setItem(`agent-chat-${agent.id}`, JSON.stringify(messages));
  }, [messages, agent.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!hasInitiallyScrolled) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      setHasInitiallyScrolled(true);
    } else if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, pendingToolCalls, hasInitiallyScrolled, isNearBottom]);

  const handleStop = useCallback(() => {
    if (sessionId) {
      abortControllerRef.current?.abort();
      agentsApi.stopStreaming(agent.id, sessionId).catch(() => {});
      stopStreaming(sessionId);
    }
    setIsThinking(false);
    toast.info('Streaming stopped');
  }, [agent.id, sessionId, stopStreaming]);

  const handleRetry = useCallback(async () => {
    setError(null);
    toast.success('Ready', 'Connection restored');
  }, []);

  const handleSend = async (message: string, attachments: Attachment[]) => {
    if (!message && attachments.length === 0) return;
    if (isStreaming(sessionId || 'new')) return;

    startStreaming(sessionId || 'new');
    setIsThinking(true);
    setPendingToolCalls({});
    setError(null);
    abortControllerRef.current = new AbortController();

    // Add user message immediately
    const userMessage: MessageWithTools = {
      role: 'user',
      content: message,
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const stream = agentsApi.streamChat(
        agent.id,
        {
          sessionId,
          message: message,
          attachments,
        },
        abortControllerRef.current.signal
      );

      let assistantContent = '';
      let currentToolCall: ToolCallWithStatus | null = null;

      for await (const { event, data } of stream) {
        switch (event) {
          case 'session':
            if ((data as { sessionId: string }).sessionId) {
              setSessionId((data as { sessionId: string }).sessionId);
            }
            break;
          case 'thinking':
            setIsThinking((data as ThinkingEvent).active);
            break;
          case 'token':
            assistantContent += (data as TokenEvent).text;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: assistantContent }];
              }
              return [...prev, { role: 'assistant', content: assistantContent }];
            });
            break;
          case 'tool_call': {
            const toolData = data as ToolCallEvent;
            currentToolCall = {
              id: toolData.id,
              type: 'function',
              function: { name: toolData.name, arguments: toolData.args },
              args: toolData.args,
              status: 'running',
            };
            setPendingToolCalls((prev) => ({
              ...prev,
              [toolData.id]: currentToolCall!,
            }));
            break;
          }
          case 'tool_result': {
            const resultData = data as ToolResultEvent;
            if (currentToolCall && currentToolCall.id === resultData.id) {
              const updated: ToolCallWithStatus = {
                ...currentToolCall,
                status: resultData.error ? 'error' : 'done',
                result: resultData.result,
                diff: resultData.diff,
                error: resultData.error,
              };
              
              setPendingToolCalls((prev) => ({
                ...prev,
                [resultData.id]: updated,
              }));

              // Move completed tool call to messages
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  const existingTools = last.toolCalls || [];
                  return [
                    ...prev.slice(0, -1),
                    { ...last, toolCalls: [...existingTools, updated] },
                  ];
                }
                return prev;
              });
            }
            break;
          }
          case 'status':
            // Status updates (e.g., context compacted)
            break;
          case 'done':
            stopStreaming(sessionId || 'new');
            break;
          case 'error': {
            const errorData = data as { message: string; type?: string };
            setError({
              message: errorData.message,
              type: 'server',
              recoverable: true,
            });
            toast.error('Chat error', errorData.message);
            break;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // User cancelled
      } else {
        let errorState: ErrorState;
        if (err instanceof NetworkError) {
          errorState = {
            type: 'network',
            message: 'Unable to connect to the server. Please check your connection.',
            recoverable: true,
          };
        } else if (err instanceof TimeoutError) {
          errorState = {
            type: 'timeout',
            message: 'The server is taking too long to respond.',
            recoverable: true,
          };
        } else {
          errorState = {
            type: 'unknown',
            message: err instanceof Error ? err.message : 'Failed to send message',
            recoverable: true,
          };
        }
        setError(errorState);
        toast.error('Failed to send message', errorState.message);
      }
    } finally {
      stopStreaming(sessionId || 'new');
      setIsThinking(false);
      setPendingToolCalls({});
      abortControllerRef.current = null;
    }
  };

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      content: `Chat cleared. I'm ${agent.name}. How can I help you?`,
    }]);
    setSessionId(undefined);
    localStorage.removeItem(`agent-chat-${agent.id}`);
  };

  // Handle scroll detection
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    setIsNearBottom(scrollHeight - scrollTop - clientHeight < 100);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Chat with {agent.name}</h2>
          <p className="text-sm text-muted-foreground">
            Full tool access with agent context and memory
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearChat}>
          Clear Chat
        </Button>
      </div>

      {/* Error Banner */}
      {error && error.recoverable && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-yellow-700">{error.message}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleRetry} className="gap-1">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2"
      >
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} agentName={agent.name} />
        ))}

        {/* Thinking Indicator */}
        {isThinking && (
          <ThinkingIndicator agentName={agent.name} />
        )}

        {/* Pending Tool Calls */}
        {Object.values(pendingToolCalls).length > 0 && (
          <div className="space-y-2">
            {Object.values(pendingToolCalls).map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="mt-auto">
        <SmartChatInput
          ref={smartInputRef}
          onSend={handleSend}
          isLoading={isStreaming(sessionId || 'new')}
          placeholder={`Ask ${agent.name} anything...`}
          showStopButton={isStreaming(sessionId || 'new')}
          onStop={handleStop}
        />
      </div>
    </div>
  );
}

function MessageBubble({ 
  message, 
  agentName 
}: { 
  message: MessageWithTools; 
  agentName: string;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 sm:gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm sm:text-base ${
        isUser ? 'bg-primary text-white' : 'bg-primary text-white'
      }`}>
        {isUser ? 'U' : agentName.charAt(0).toUpperCase()}
      </div>
      <div className={`flex-1 min-w-0 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`inline-block max-w-[90%] sm:max-w-[85%] px-3 sm:px-4 py-2 sm:py-3 rounded-2xl text-sm sm:text-base ${
          isUser 
            ? 'bg-primary text-white rounded-tr-sm' 
            : 'bg-card border border-border rounded-tl-sm'
        }`}>
          <div className={`prose prose-slate max-w-none overflow-hidden break-words ${isUser ? 'text-white' : ''} prose-sm sm:prose-base`}>
            {message.content && (
              <MarkdownRenderer content={typeof message.content === 'string' ? message.content : JSON.stringify(message.content)} />
            )}
          </div>
        </div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 sm:mt-4 space-y-2 w-full">
            {message.toolCalls.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ agentName }: { agentName: string }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary text-white flex items-center justify-center flex-shrink-0 text-sm sm:text-base">
        {agentName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 flex items-center gap-1 text-muted-foreground">
        <Brain className="w-4 h-4 animate-pulse" />
        <span className="text-sm">Thinking...</span>
      </div>
    </div>
  );
}
