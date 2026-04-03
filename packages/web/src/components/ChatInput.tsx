import { useRef, useCallback } from 'react';
import { Paperclip, Send, Square } from 'lucide-react';
import { Button } from './ui/button';
import { VoiceInputButton } from './VoiceInputButton';
import { toast } from './Toast';
import type { Attachment } from '../types/api';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  isLoading?: boolean;
  attachments?: Attachment[];
  onAddAttachment?: (attachment: Attachment) => void;
  onRemoveAttachment?: (index: number) => void;
  placeholder?: string;
  showVoiceInput?: boolean;
  showAttachments?: boolean;
  showStopButton?: boolean;
  onStop?: () => void;
}

export function ChatInput({
  input,
  setInput,
  onSend,
  isLoading = false,
  attachments = [],
  onAddAttachment,
  onRemoveAttachment,
  placeholder = "Type a message...",
  showVoiceInput = true,
  showAttachments = true,
  showStopButton = true,
  onStop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !onAddAttachment) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        onAddAttachment({
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
  }, [onAddAttachment]);

  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const handleVoiceTranscript = (transcript: string) => {
    setInput(input + (input ? ' ' : '') + transcript);
    // Focus and resize textarea
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        textareaRef.current.focus();
      }
    }, 0);
  };

  const canSend = input.trim() || attachments.length > 0;

  return (
    <div className="space-y-2">
      {/* Attachments Preview */}
      {showAttachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachments.map((attachment, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 bg-accent rounded-lg text-sm border border-border"
            >
              <span className="truncate max-w-[150px]">{attachment.name}</span>
              {onRemoveAttachment && (
                <button
                  onClick={() => onRemoveAttachment(index)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            rows={1}
            className="w-full min-h-[44px] max-h-[200px] px-4 py-2.5 bg-background border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-ring pr-24 text-sm leading-relaxed"
          />
          {/* Input Actions - Inside Textarea */}
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            {showVoiceInput && !isLoading && (
              <VoiceInputButton
                onTranscript={handleVoiceTranscript}
                disabled={isLoading}
              />
            )}
            {showAttachments && onAddAttachment && (
              <button
                onClick={handleAttachmentClick}
                disabled={isLoading}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
                title="Attach file"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {isLoading && showStopButton && onStop ? (
          <Button
            onClick={onStop}
            variant="destructive"
            size="icon"
            className="h-[44px] w-[44px] animate-pulse self-end"
          >
            <Square className="w-4 h-4" fill="currentColor" />
          </Button>
        ) : (
          <Button
            onClick={onSend}
            disabled={isLoading || !canSend}
            className="h-[44px] px-4 self-end"
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Hidden File Input */}
      {showAttachments && onAddAttachment && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      )}
    </div>
  );
}
