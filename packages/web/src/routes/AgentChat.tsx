import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Square, MoreVertical, FileText, Trash2, Download, AlertCircle, RefreshCw } from "lucide-react";
import { sessionsQueries } from "../api/queries";
import { api, personasApi, NetworkError, TimeoutError } from "../api/client";
import { useAppStore } from "../stores/appStore";
import { streamChat } from "../api/client";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ToolCard } from "../components/ToolCard";
import { ModelPicker } from "../components/ModelPicker";
import { ImageLightbox } from "../components/ImageLightbox";
import { VoiceInputButton } from "../components/VoiceInputButton";
import { toast } from "../components/Toast";
import type { Message, Attachment, ToolCall, ToolCallEvent, ToolResultEvent, Persona, ThinkingEvent, TokenEvent } from "../types/api";

// Extended tool call with runtime status
interface ToolCallWithStatus extends ToolCall {
  status: "running" | "done" | "error";
  args: string;
  result?: string;
  diff?: string;
  error?: boolean;
}

interface MessageWithTools extends Message {
  toolCalls?: ToolCallWithStatus[];
}

interface PersonaChatResponse {
  id: string;
  name: string;
  persona: Persona;
  existing: boolean;
}

interface AgentChatViewProps {
  personaId?: string;
}

interface ErrorState {
  type: 'network' | 'timeout' | 'server' | 'unknown';
  message: string;
  recoverable: boolean;
}

export function AgentChatView({ personaId: propPersonaId }: AgentChatViewProps = {}) {
  const { sessionId, personaId: routePersonaId } = useParams<{ sessionId: string; personaId: string }>();
  const effectivePersonaId = propPersonaId || routePersonaId;
  const queryClient = useQueryClient();
  
  const { 
    attachments, 
    addAttachment, 
    removeAttachment,
    clearAttachments, 
    isStreaming, 
    startStreaming, 
    stopStreaming,
    selectedModel,
    setSelectedModel,
  } = useAppStore();
  
  const [messages, setMessages] = useState<MessageWithTools[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<Record<string, ToolCallWithStatus>>({});
  const [showMenu, setShowMenu] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [personaSession, setPersonaSession] = useState<PersonaChatResponse | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [personaError, setPersonaError] = useState<ErrorState | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch session data
  const { data: session, isError: isSessionError, error: sessionError } = useSuspenseQuery({
    ...sessionsQueries.detail(sessionId || 'new'),
    retry: 3,
  });

  // Handle session loading errors
  useEffect(() => {
    if (isSessionError && sessionError && !error) {
      let errorState: ErrorState;
      
      if (sessionError instanceof NetworkError) {
        errorState = {
          type: 'network',
          message: 'Unable to connect to the server. Please check your connection.',
          recoverable: true,
        };
      } else if (sessionError instanceof TimeoutError) {
        errorState = {
          type: 'timeout',
          message: 'The server is taking too long to respond.',
          recoverable: true,
        };
      } else if (sessionError instanceof Error && sessionError.message?.includes('404')) {
        errorState = {
          type: 'server',
          message: 'This chat session doesn\'t exist or has been deleted.',
          recoverable: false,
        };
      } else {
        errorState = {
          type: 'unknown',
          message: 'Failed to load chat session. Please try again.',
          recoverable: true,
        };
      }
      
      setError(errorState);
      toast.error('Failed to load chat', errorState.message, 10000);
    }
  }, [isSessionError, sessionError, error]);
  
  // Fetch or create persona chat session when personaId changes
  useEffect(() => {
    if (effectivePersonaId && !sessionId) {
      personasApi.chat(effectivePersonaId)
        .then(setPersonaSession)
        .catch((err) => {
          let errorState: ErrorState;
          if (err instanceof NetworkError) {
            errorState = {
              type: 'network',
              message: 'Unable to connect to create persona chat.',
              recoverable: true,
            };
          } else if (err instanceof TimeoutError) {
            errorState = {
              type: 'timeout',
              message: 'Request timed out while creating persona chat.',
              recoverable: true,
            };
          } else {
            errorState = {
              type: 'unknown',
              message: err.message || 'Failed to create persona chat.',
              recoverable: false,
            };
          }
          setPersonaError(errorState);
          toast.error('Persona chat error', errorState.message, 10000);
        });
    }
  }, [effectivePersonaId, sessionId]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (session?.messages) {
      setMessages(session.messages.filter((m) => m.role !== 'system'));
      setError(null); // Clear error on successful load
    }
  }, [session]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingToolCalls]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    stopStreaming(sessionId || 'new');
    setIsThinking(false);
    toast.info('Streaming stopped');
  }, [sessionId, stopStreaming]);

  const handleRetry = useCallback(async () => {
    setError(null);
    setPersonaError(null);
    
    try {
      await queryClient.invalidateQueries({ queryKey: sessionsQueries.all() });
      if (effectivePersonaId && !sessionId) {
        const session = await personasApi.chat(effectivePersonaId);
        setPersonaSession(session);
      }
      toast.success('Connection restored', 'Successfully reconnected to the server');
    } catch {
      toast.error('Retry failed', 'Still unable to connect. Please try again later.', 8000);
    }
  }, [queryClient, effectivePersonaId, sessionId]);

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return;
    if (isStreaming(sessionId || 'new')) return;

    const currentSessionId = sessionId || personaSession?.id;
    if (!currentSessionId) {
      toast.error('No session', 'Unable to send message - no session available', 5000);
      return;
    }

    startStreaming(currentSessionId);
    setIsThinking(true);
    setPendingToolCalls({});
    setError(null);
    abortControllerRef.current = new AbortController();

    // Add user message immediately
    const userMessage: MessageWithTools = {
      role: "user",
      content: input,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const stream = streamChat({
        sessionId: currentSessionId,
        message: input,
        attachments,
        model: selectedModel,
      }, abortControllerRef.current.signal);

      let assistantContent = "";
      let currentToolCall: ToolCallWithStatus | null = null;

      for await (const { event, data } of stream) {
        switch (event) {
          case "session":
            break;
          case "thinking":
            setIsThinking((data as ThinkingEvent).active);
            break;
          case "token":
            assistantContent += (data as TokenEvent).text;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: assistantContent }];
              }
              return [...prev, { role: "assistant", content: assistantContent }];
            });
            break;
          case "tool_call": {
            const toolData = data as ToolCallEvent;
            currentToolCall = { 
              id: toolData.id, 
              type: 'function',
              function: { name: toolData.name, arguments: toolData.args },
              args: toolData.args,
              status: "running",
            };
            setPendingToolCalls((prev) => ({
              ...prev,
              [toolData.id]: currentToolCall!,
            }));
            break;
          }
          case "tool_result": {
            const resultData = data as ToolResultEvent;
            if (currentToolCall && currentToolCall.id === resultData.id) {
              const updated: ToolCallWithStatus = {
                ...currentToolCall,
                status: resultData.error ? "error" : "done",
                result: resultData.result,
                diff: resultData.diff,
                error: resultData.error,
              };
              
              setPendingToolCalls((prev) => ({
                ...prev,
                [resultData.id]: updated,
              }));

              // Show error toast if tool call failed
              if (resultData.error) {
                toast.error(
                  `${currentToolCall.function.name} failed`,
                  resultData.result || 'An error occurred during tool execution',
                  6000
                );
              }
            }
            break;
          }
          case "done":
            setIsThinking(false);
            clearAttachments();
            // Move pending tool calls to the last message
            const toolCalls = Object.values(pendingToolCalls);
            if (toolCalls.length > 0 || currentToolCall) {
              const allToolCalls = currentToolCall 
                ? [...toolCalls, currentToolCall]
                : toolCalls;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [...prev.slice(0, -1), { ...last, toolCalls: allToolCalls }];
                }
                return prev;
              });
            }
            setPendingToolCalls({});
            // Refresh session data
            queryClient.invalidateQueries({ queryKey: sessionsQueries.detail(currentSessionId).queryKey });
            break;
          case "error":
            const errorData = data as { message?: string; error?: string };
            const errorMessage = errorData.message || errorData.error || 'An error occurred';
            toast.error('Chat error', errorMessage, 8000);
            setIsThinking(false);
            break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        let errorState: ErrorState;
        
        if (err instanceof NetworkError) {
          errorState = {
            type: 'network',
            message: 'Connection lost. Please check your internet and try again.',
            recoverable: true,
          };
          toast.error('Connection lost', 'Please check your internet connection', 8000);
        } else if (err instanceof TimeoutError) {
          errorState = {
            type: 'timeout',
            message: 'Request timed out. The server may be busy.',
            recoverable: true,
          };
          toast.error('Request timeout', 'The server is taking too long to respond', 8000);
        } else {
          errorState = {
            type: 'unknown',
            message: err.message || 'Failed to send message',
            recoverable: true,
          };
          toast.error('Message failed', err.message || 'Failed to send message', 8000);
        }
        
        setError(errorState);
      }
    } finally {
      stopStreaming(currentSessionId);
      setIsThinking(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        addAttachment({
          type: file.type.startsWith('image/') ? 'image' : 'file',
          name: file.name,
          mimeType: file.type,
          data: base64,
        });
        toast.success('File attached', file.name, 3000);
      };
      reader.onerror = () => {
        toast.error('Failed to read file', 'Please try a different file', 5000);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const handleRemoveAttachment = useCallback((index: number) => {
    removeAttachment(index);
  }, [removeAttachment]);

  const handleExport = useCallback(async () => {
    const currentSessionId = sessionId || personaSession?.id;
    if (!currentSessionId) return;
    try {
      const markdown = await api.sessions.exportSession(currentSessionId);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-chat-${currentSessionId}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Chat exported', 'Download started', 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export';
      toast.error('Export failed', message, 6000);
    }
    setShowMenu(false);
  }, [sessionId, personaSession]);

  const handleClear = useCallback(async () => {
    const currentSessionId = sessionId || personaSession?.id;
    if (!currentSessionId) return;
    if (!confirm("Clear all messages in this agent chat?")) return;
    try {
      await api.sessions.clearSession(currentSessionId);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: sessionsQueries.detail(currentSessionId).queryKey });
      toast.success('Chat cleared', 'All messages have been removed', 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear chat';
      toast.error('Clear failed', message, 6000);
    }
    setShowMenu(false);
  }, [sessionId, personaSession, queryClient]);

  const streaming = isStreaming(sessionId || personaSession?.id || 'new');
  
  // Get persona info for display
  const persona = session?.type === 'agent' ? session.persona : personaSession?.persona;
  const personaName = persona?.name || session?.name || personaSession?.name || 'Agent';
  const personaRole = persona?.role || 'AI Assistant';
  const personaInitial = personaName.charAt(0).toUpperCase();

  // Error UI
  if ((error || personaError) && !messages.length) {
    const displayError = error || personaError;
    return (
      <div className="flex flex-col h-full bg-kai-bg">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-kai-bg-surface border border-kai-border rounded-xl p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-kai-red-light flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-kai-red" />
              </div>
            </div>
            <h1 className="text-xl font-semibold text-kai-text mb-2">
              {displayError?.type === 'network' ? 'Connection Error' : 
               displayError?.type === 'timeout' ? 'Request Timeout' : 
               displayError?.type === 'server' ? 'Session Not Found' : 'Something went wrong'}
            </h1>
            <p className="text-kai-text-secondary mb-6">{displayError?.message}</p>
            <div className="flex items-center justify-center gap-3">
              {displayError?.recoverable && (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
              )}
              <a
                href="/agents"
                className="flex items-center gap-2 px-4 py-2 bg-kai-bg-hover border border-kai-border rounded-lg text-sm font-medium hover:bg-kai-border transition-colors"
              >
                Back to Agents
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-kai-bg">
      {/* Header with Persona Info */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-kai-border bg-kai-bg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-kai-purple to-violet-700 flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
            {personaInitial}
          </div>
          <div>
            <div className="font-medium text-kai-text text-sm">{personaName}</div>
            <div className="text-xs text-kai-text-muted">{personaRole}</div>
          </div>
          <div className="h-4 w-px bg-kai-border mx-2" />
          <ModelPicker value={selectedModel} onChange={setSelectedModel} />
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg hover:bg-kai-bg-hover text-kai-text-muted hover:text-kai-text"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-kai-bg-surface border border-kai-border rounded-lg shadow-lg py-1 z-50">
              <button
                onClick={handleExport}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-kai-text hover:bg-kai-bg-hover"
              >
                <Download className="w-4 h-4" />
                Export as Markdown
              </button>
              <button
                onClick={handleClear}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-kai-red hover:bg-kai-bg-hover"
              >
                <Trash2 className="w-4 h-4" />
                Clear Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {(error || personaError) && messages.length > 0 && (
        <div className="px-4 py-2 bg-kai-red-light border-b border-kai-red">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <div className="flex items-center gap-2 text-kai-red text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{(error || personaError)?.message}</span>
            </div>
            <button
              onClick={handleRetry}
              className="text-sm text-kai-teal hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <WelcomeScreen 
              personaName={personaName}
              personaRole={personaRole}
              onSelect={(text) => setInput(text)} 
            />
          ) : (
            <div className="space-y-6">
              {messages.map((message, i) => (
                <AgentMessageBubble 
                  key={i} 
                  message={message}
                  personaName={personaName}
                  personaInitial={personaInitial}
                  onImageClick={setLightboxImage}
                />
              ))}
              {/* Pending tool calls */}
              {Object.values(pendingToolCalls).length > 0 && (
                <div className="pl-14 space-y-2">
                  {Object.values(pendingToolCalls).map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
              {isThinking && <ThinkingIndicator personaName={personaName} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-kai-border bg-kai-bg p-4">
        <div className="max-w-3xl mx-auto">
          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto">
              {attachments.map((att, i) => (
                <AttachmentPreview
                  key={i}
                  attachment={att}
                  onRemove={() => handleRemoveAttachment(i)}
                />
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2 bg-kai-bg-surface border border-kai-border rounded-2xl p-2">
            <input
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.csv,.js,.ts,.py,.html,.css,.tsx,.jsx"
              className="hidden"
              id="file-upload"
              onChange={handleFileChange}
            />
            <label
              htmlFor="file-upload"
              className="p-2 rounded-full hover:bg-kai-bg-hover text-kai-text-muted hover:text-kai-text cursor-pointer flex-shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </label>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={(error || personaError) ? "Connection issues - messages may not send" : `Message ${personaName}...`}
              rows={1}
              className="flex-1 min-h-[44px] max-h-[200px] py-2.5 px-1 bg-transparent border-none outline-none resize-none text-kai-text placeholder:text-kai-text-muted"
              style={{ lineHeight: "1.5" }}
              disabled={!!(error || personaError) && !(error?.recoverable || personaError?.recoverable)}
            />

            <VoiceInputButton 
              onTranscript={(text) => setInput(prev => prev + text)}
              disabled={streaming}
            />

            {streaming ? (
              <button
                onClick={handleStop}
                className="p-2 rounded-full bg-kai-red text-white hover:bg-opacity-90 flex-shrink-0 animate-pulse"
              >
                <Square className="w-5 h-5" fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || (!!(error || personaError) && !(error?.recoverable || personaError?.recoverable))}
                className="p-2 rounded-full bg-kai-text text-white hover:bg-opacity-90 disabled:opacity-40 flex-shrink-0"
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox 
          src={lightboxImage} 
          onClose={() => setLightboxImage(null)} 
        />
      )}
    </div>
  );
}

function AttachmentPreview({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const isImage = attachment.type === 'image';
  
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-kai-bg-surface border border-kai-border rounded-lg text-sm group flex-shrink-0">
      {isImage ? (
        <div className="w-8 h-8 rounded bg-kai-bg-hover overflow-hidden">
          <img 
            src={`data:${attachment.mimeType};base64,${attachment.data}`}
            alt={attachment.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <FileText className="w-4 h-4 text-kai-teal" />
      )}
      <span className="truncate max-w-[120px]">{attachment.name}</span>
      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-kai-bg-hover text-kai-text-muted hover:text-kai-red"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function AgentMessageBubble({ 
  message, 
  personaName,
  personaInitial,
  onImageClick 
}: { 
  message: MessageWithTools;
  personaName: string;
  personaInitial: string;
  onImageClick?: (src: string) => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser 
          ? 'bg-kai-text text-white' 
          : 'bg-gradient-to-br from-kai-purple to-violet-700 text-white'
      }`}>
        {isUser ? 'U' : personaInitial}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div className={`text-xs text-kai-text-muted mb-1 ${isUser ? 'text-right' : ''}`}>
          {isUser ? 'You' : personaName}
        </div>
        <div className={`prose prose-slate max-w-none ${isUser ? 'text-right' : ''}`}>
          {message.content && typeof message.content === 'string' && (
            <MarkdownRenderer content={message.content} onImageClick={onImageClick} />
          )}
        </div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.toolCalls.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ personaName }: { personaName: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-kai-purple to-violet-700 text-white flex items-center justify-center flex-shrink-0 text-sm font-bold">
        {personaName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 flex items-center gap-1 text-kai-text-muted">
        <span className="w-2 h-2 rounded-full bg-kai-teal animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 rounded-full bg-kai-teal animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 rounded-full bg-kai-teal animate-bounce" style={{ animationDelay: '300ms' }} />
        <span className="ml-2 text-sm">{personaName} is thinking...</span>
      </div>
    </div>
  );
}

function WelcomeScreen({ 
  personaName,
  personaRole,
  onSelect 
}: { 
  personaName: string;
  personaRole: string;
  onSelect: (text: string) => void;
}) {
  const suggestions = [
    `Help me understand ${personaName}'s expertise...`,
    "What tasks can you help me with?",
    "Let's start a new project",
    "I have a question about...",
  ];

  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-kai-purple to-violet-700 flex items-center justify-center text-white text-2xl font-bold">
        {personaName.charAt(0).toUpperCase()}
      </div>
      <h2 className="text-2xl font-semibold text-kai-text mb-2">{personaName}</h2>
      <p className="text-kai-text-secondary mb-8">{personaRole}</p>
      <div className="grid gap-3 max-w-md mx-auto">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSelect(suggestion)}
            className="p-3 bg-kai-bg-surface border border-kai-border rounded-lg text-left text-sm text-kai-text-secondary hover:border-kai-teal hover:text-kai-text transition-colors"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
