import { useState, useCallback } from 'react';
import { ChatInput } from './ChatInput';
import type { Attachment } from '../types/api';

interface SmartChatInputProps {
  onSend: (message: string, attachments: Attachment[]) => void | Promise<void>;
  isLoading?: boolean;
  placeholder?: string;
  showVoiceInput?: boolean;
  showAttachments?: boolean;
  showStopButton?: boolean;
  onStop?: () => void;
}

export function SmartChatInput({
  onSend,
  isLoading = false,
  placeholder = "Type a message...",
  showVoiceInput = true,
  showAttachments = true,
  showStopButton = true,
  onStop,
}: SmartChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleSend = useCallback(async () => {
    if (!input.trim() && attachments.length === 0) return;
    if (isLoading) return;

    const message = input.trim();
    const currentAttachments = [...attachments];

    // Clear immediately for better UX
    setInput('');
    setAttachments([]);

    try {
      await onSend(message, currentAttachments);
    } catch {
      // Restore on error so user can retry
      setInput(message);
      setAttachments(currentAttachments);
    }
  }, [input, attachments, isLoading, onSend]);

  const handleAddAttachment = useCallback((attachment: Attachment) => {
    setAttachments(prev => [...prev, attachment]);
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <ChatInput
      input={input}
      setInput={setInput}
      onSend={handleSend}
      isLoading={isLoading}
      attachments={attachments}
      onAddAttachment={showAttachments ? handleAddAttachment : undefined}
      onRemoveAttachment={showAttachments ? handleRemoveAttachment : undefined}
      placeholder={placeholder}
      showVoiceInput={showVoiceInput}
      showAttachments={showAttachments}
      showStopButton={showStopButton}
      onStop={onStop}
    />
  );
}
