import { Mic, MicOff, AlertCircle } from 'lucide-react';
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
    requestMicrophonePermission,
  } = useVoiceInput();

  // Send final transcript to parent when listening stops
  const handleToggle = async () => {
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

  const handlePermissionClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await requestMicrophonePermission();
  };

  // Check if error is permission-related
  const isPermissionError = error && (
    error.includes('not allowed') ||
    error.includes('permission') ||
    error.includes('Permission')
  );

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
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`
          p-2 rounded-full transition-all duration-200 relative
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
      </button>

      {/* Permission Error Popup */}
      {isPermissionError && !isListening && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-destructive/95 text-white rounded-lg p-3 shadow-lg z-50">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-1">Microphone Access Denied</p>
              <p className="text-xs opacity-90 mb-2">To use voice input, enable microphone permissions:</p>
              <ul className="text-xs opacity-90 list-disc pl-4 mb-2 space-y-0.5">
                <li>Click the 🔒 lock icon in the address bar</li>
                <li>Find "Microphone" and select "Allow"</li>
                <li>Reload the page</li>
              </ul>
              <button
                onClick={handlePermissionClick}
                className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors"
              >
                Try Requesting Permission Again
              </button>
            </div>
          </div>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-destructive/95" />
        </div>
      )}

      {/* General Error Tooltip */}
      {error && !isListening && !isPermissionError && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-background border border-border rounded-lg p-2 shadow-lg z-50">
          <p className="text-xs text-destructive">{error}</p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
        </div>
      )}
    </div>
  );
}
