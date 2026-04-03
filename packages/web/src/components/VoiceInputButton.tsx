import { Mic, MicOff } from 'lucide-react';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface VoiceInputButtonProps {
  onTranscript: (transcript: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({ onTranscript, disabled }: VoiceInputButtonProps) {
  const {
    isListening,
    transcript,
    interimTranscript,
    isSupported,
    error,
    startListening,
    stopListening,
    resetTranscript,
  } = useVoiceInput();

  // Send final transcript to parent when listening stops
  const handleToggle = () => {
    if (isListening) {
      stopListening();
      // Combine final and interim for best results
      const finalText = transcript + (interimTranscript ? ' ' + interimTranscript : '');
      if (finalText.trim()) {
        onTranscript(finalText.trim());
      }
      resetTranscript();
    } else {
      resetTranscript();
      startListening();
    }
  };

  // If not supported, show disabled button with tooltip
  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        className="p-2 rounded-full text-muted-foreground opacity-40 cursor-not-allowed flex-shrink-0"
        title="Voice input not supported in this browser (try Chrome, Edge, or Safari)"
      >
        <MicOff className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      className={`
        p-2 rounded-full flex-shrink-0 transition-all duration-200 relative
        ${isListening 
          ? 'bg-destructive text-white animate-pulse' 
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
      title={isListening 
        ? 'Click to stop recording' 
        : error 
          ? `Error: ${error}` 
          : 'Click to start voice input'
      }
    >
      {isListening ? (
        <div className="relative">
          <Mic className="w-5 h-5" />
          {/* Pulsing ring animation */}
          <span className="absolute inset-0 rounded-full animate-ping bg-destructive opacity-75" />
          {/* Recording indicator ring */}
          <span className="absolute -inset-1 rounded-full border-2 border-destructive animate-pulse" />
        </div>
      ) : (
        <Mic className="w-5 h-5" />
      )}
      
      {/* Error tooltip indicator */}
      {error && !isListening && (
        <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full" />
      )}
    </button>
  );
}

