import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Square, MoreVertical, FileText, Trash2, AlertCircle, RefreshCw, Home } from "lucide-react";
import { sessionsQueries } from "../api/queries";
import { api, NetworkError, TimeoutError } from "../api/client";
import { useAppStore } from "../stores/appStore";
import { streamChat } from "../api/client";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ToolCard } from "../components/ToolCard";
import { ImageLightbox } from "../components/ImageLightbox";
import { VoiceInputButton } from "../components/VoiceInputButton";
import { toast } from "../components/Toast";
import type { Message, Attachment, ToolCallWithStatus, ToolCallEvent, ToolResultEvent, ThinkingEvent, TokenEvent } from "../types/api";

interface MessageWithTools extends Message {
  toolCalls?: ToolCallWithStatus[];
}

interface ErrorState {
  type: 'network' | 'timeout' | 'server' | 'unknown';
  message: string;
  recoverable: boolean;
}

export function ChatView() {
  const { sessionId } = useParams();
  const queryClient = useQueryClient();
  const { 
    attachments, 
    addAttachment, 
    removeAttachment,
    clearAttachments, 
    isStreaming, 
    startStreaming, 
    stopStreaming,
  } = useAppStore();
  const [messages, setMessages] = useState<MessageWithTools[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<Record<string, ToolCallWithStatus>>({});
  const [showMenu, setShowMenu] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: session, isError: isSessionError, error: sessionError } = useSuspenseQuery({
    ...sessionsQueries.detail(sessionId || 'new'),
    retry: 3,
  });

  // Handle session loading errors
  useEffect(() => {
    if (isSessionError && sessionError) {
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
  }, [isSessionError, sessionError]);

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

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    stopStreaming(sessionId || 'new');
    setIsThinking(false);
    toast.info('Streaming stopped');
  }, [sessionId, stopStreaming]);

  const handleRetry = useCallback(async () => {
    setError(null);
    setRetryCount(c => c + 1);
    
    try {
      await queryClient.invalidateQueries({ queryKey: sessionsQueries.all() });
      toast.success('Connection restored', 'Successfully reconnected to the server');
    } catch {
      toast.error('Retry failed', 'Still unable to connect. Please try again later.', 8000);
    }
  }, [queryClient]);

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return;
    if (isStreaming(sessionId || 'new')) return;

    const currentSessionId = sessionId;
    startStreaming(currentSessionId || 'new');
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
            queryClient.invalidateQueries({ queryKey: sessionsQueries.detail(currentSessionId || 'new').queryKey });
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
      stopStreaming(currentSessionId || 'new');
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
    if (!sessionId) return;
    try {
      const markdown = await api.sessions.exportSession(sessionId);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${sessionId}.md`;
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
  }, [sessionId]);

  const handleClear = useCallback(async () => {
    if (!sessionId) return;
    if (!confirm("Clear all messages in this chat?")) return;
    try {
      await api.sessions.clearSession(sessionId);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: sessionsQueries.detail(sessionId).queryKey });
      toast.success('Chat cleared', 'All messages have been removed', 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear chat';
      toast.error('Clear failed', message, 6000);
    }
    setShowMenu(false);
  }, [sessionId, queryClient]);

  const streaming = isStreaming(sessionId || 'new');

  // Error UI
  if (error && !messages.length) {
    return (
      <div className="flex flex-col h-full bg-kai-bg">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
            </div>
            <h1 className="text-xl font-semibold text-kai-text mb-2">
              {error.type === 'network' ? 'Connection Error' : 
               error.type === 'timeout' ? 'Request Timeout' : 
               error.type === 'server' ? 'Session Not Found' : 'Something went wrong'}
            </h1>
            <p className="text-muted-foreground mb-6">{error.message}</p>
            <div className="flex items-center justify-center gap-3">
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
              <a
                href="/chat"
                className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-border rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
              >
                <Home className="w-4 h-4" />
                New Chat
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-kai-bg">
      {/* Header */}
      <div className="flex items-center justify-end px-4 py-2 border-b border-border bg-kai-bg">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg hover:bg-accent/10 text-muted-foreground hover:text-kai-text"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-lg py-1 z-50">
              <button
                onClick={handleExport}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-kai-text hover:bg-accent/10"
              >
                <FileText className="w-4 h-4" />
                Export as Markdown
              </button>
              <button
                onClick={handleClear}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-destructive hover:bg-accent/10"
              >
                <Trash2 className="w-4 h-4" />
                Clear Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && messages.length > 0 && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-kai-red">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{error.message}</span>
            </div>
            {error.recoverable && (
              <button
                onClick={handleRetry}
                className="text-sm text-primary hover:underline"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <WelcomeScreen onSelect={(text) => setInput(text)} />
          ) : (
            <div className="space-y-6">
              {messages.map((message, i) => (
                <MessageBubble 
                  key={i} 
                  message={message} 
                  onImageClick={setLightboxImage}
                />
              ))}
              {/* Pending tool calls */}
              {Object.values(pendingToolCalls).length > 0 && (
                <div className="pl-10 space-y-2">
                  {Object.values(pendingToolCalls).map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
              {isThinking && <ThinkingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-border bg-kai-bg p-4">
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

          <div className="relative flex items-end gap-2 bg-card border border-border rounded-2xl p-2">
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
              className="p-2 rounded-full hover:bg-accent/10 text-muted-foreground hover:text-kai-text cursor-pointer flex-shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </label>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={error ? "Connection issues - messages may not send" : "How can I help you today?"}
              rows={1}
              className="flex-1 min-h-[44px] max-h-[200px] py-2.5 px-1 bg-transparent border-none outline-none resize-none text-kai-text placeholder:text-muted-foreground"
              style={{ lineHeight: "1.5" }}
              disabled={!!error && !error.recoverable}
            />

            <VoiceInputButton 
              onTranscript={(text) => setInput(prev => prev + text)}
              disabled={streaming}
            />

            {streaming ? (
              <button
                onClick={handleStop}
                className="p-2 rounded-full bg-kai-red text-white hover:bg-primary/90 flex-shrink-0 animate-pulse"
              >
                <Square className="w-5 h-5" fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || (!!error && !error.recoverable)}
                className="p-2 rounded-full bg-kai-text text-white hover:bg-primary/90 disabled:opacity-40 flex-shrink-0"
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

// Missing imports from original file
function AttachmentPreview({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const isImage = attachment.type === 'image';
  
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-sm group">
      {isImage ? (
        <div className="w-8 h-8 rounded bg-accent/10 overflow-hidden">
          <img 
            src={`data:${attachment.mimeType};base64,${attachment.data}`}
            alt={attachment.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <FileText className="w-4 h-4 text-primary" />
      )}
      <span className="truncate max-w-[120px]">{attachment.name}</span>
      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-accent/10 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function MessageBubble({ 
  message, 
  onImageClick 
}: { 
  message: MessageWithTools; 
  onImageClick?: (src: string) => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-kai-text text-white' : 'bg-kai-teal text-white'
      }`}>
        {isUser ? 'U' : 'K'}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'items-end' : ''}`}>
        <div className={`prose prose-slate max-w-none ${isUser ? 'text-right' : ''}`}>
          {message.content && (
            <MarkdownRenderer content={typeof message.content === 'string' ? message.content : JSON.stringify(message.content)} onImageClick={onImageClick} />
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

function ThinkingIndicator() {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full bg-kai-teal text-white flex items-center justify-center flex-shrink-0">
        K
      </div>
      <div className="flex-1 flex items-center gap-1 text-muted-foreground">
        <span className="w-2 h-2 rounded-full bg-kai-teal animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 rounded-full bg-kai-teal animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 rounded-full bg-kai-teal animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

function WelcomeScreen({ onSelect }: { onSelect: (text: string) => void }) {
  const suggestions = [
    "Help me write a Python function to...",
    "Explain how async/await works in JavaScript",
    "Create a React component for...",
    "Debug this error I'm seeing...",
  ];

  return (
    <div className="text-center py-12">
      <h2 className="text-2xl font-semibold text-kai-text mb-2">Welcome to Kai</h2>
      <p className="text-muted-foreground mb-8">What would you like to work on today?</p>
      <div className="grid gap-3 max-w-md mx-auto">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSelect(suggestion)}
            className="p-3 bg-card border border-border rounded-lg text-left text-sm text-muted-foreground hover:border-primary hover:text-kai-text transition-colors"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

