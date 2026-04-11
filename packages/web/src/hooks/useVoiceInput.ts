import { useState, useCallback, useRef, useEffect } from 'react';
import { useAudioRecorder } from './useAudioRecorder';

// Type definitions for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export type VoiceInputMode = 'speech-api' | 'audio-recorder' | null;

export interface VoiceInputState {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isSupported: boolean;
  error: string | null;
  mode: VoiceInputMode;
  recordingTime: number;
}

export interface VoiceInputActions {
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  requestMicrophonePermission: () => Promise<boolean>;
}

const WHISPER_API_URL = '/api/transcribe';

export function useVoiceInput(): VoiceInputState & VoiceInputActions {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceInputMode>(null);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRecorder = useAudioRecorder();

  // Check for browser support
  const speechApiSupported = typeof window !== 'undefined' && 
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  
  const mediaRecorderSupported = typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;
  
  const isSupported = speechApiSupported || mediaRecorderSupported;

  // Initialize speech recognition if available
  useEffect(() => {
    if (!speechApiSupported) return;

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      setMode('speech-api');
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalTranscript) {
        setTranscript((prev) => prev + finalTranscript);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // If permission denied, try audio recorder fallback
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        if (mediaRecorderSupported) {
          // Fall back to audio recorder
          setMode('audio-recorder');
          setError(null);
          // Don't set error - we'll try audio recorder
          return;
        }
      }
      
      let errorMessage = 'An error occurred with speech recognition';
      
      switch (event.error) {
        case 'no-speech':
          errorMessage = 'No speech detected. Please try again.';
          break;
        case 'aborted':
          errorMessage = 'Speech recognition was aborted.';
          break;
        case 'audio-capture':
          errorMessage = 'No microphone detected. Please check your audio settings.';
          break;
        case 'network':
          errorMessage = 'Network error occurred. Please check your connection.';
          break;
        case 'bad-grammar':
          errorMessage = 'Grammar error in speech recognition.';
          break;
        case 'language-not-supported':
          errorMessage = 'Language not supported for speech recognition.';
          break;
        default:
          errorMessage = `Speech recognition error: ${event.error}`;
      }
      
      setError(errorMessage);
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort errors
        }
      }
    };
  }, [speechApiSupported, mediaRecorderSupported]);

  // Handle audio recorder completion - transcribe with Whisper
  useEffect(() => {
    if (mode === 'audio-recorder' && audioRecorder.audioBlob) {
      transcribeAudio(audioRecorder.audioBlob);
    }
  }, [audioRecorder.audioBlob, mode]);

  const transcribeAudio = async (blob: Blob) => {
    try {
      setError(null);
      
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      
      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.text) {
        setTranscript((prev) => prev + ' ' + data.text.trim());
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
      setError(`Transcription error: ${errorMsg}`);
    }
  };

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    // Try audio recorder permission request first (most reliable)
    const granted = await audioRecorder.requestPermission();
    
    if (granted) {
      setError(null);
    }
    
    return granted;
  }, [audioRecorder]);

  const startListening = useCallback(() => {
    setError(null);
    setInterimTranscript('');
    
    // Try Web Speech API first (faster, real-time)
    if (speechApiSupported && recognitionRef.current && mode !== 'audio-recorder') {
      try {
        recognitionRef.current.start();
        return;
      } catch (err) {
        // If start fails, fall back to audio recorder
        console.log('Speech API failed, falling back to audio recorder');
      }
    }
    
    // Fall back to audio recorder
    if (mediaRecorderSupported) {
      setMode('audio-recorder');
      audioRecorder.startRecording();
    } else {
      setError('Voice input is not supported in this browser. Please use Chrome, Safari, or the desktop app.');
    }
  }, [speechApiSupported, mediaRecorderSupported, mode, audioRecorder]);

  const stopListening = useCallback(() => {
    if (mode === 'speech-api' && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    } else if (mode === 'audio-recorder') {
      audioRecorder.stopRecording();
    }
    
    setIsListening(false);
    setInterimTranscript('');
  }, [mode, audioRecorder]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
    audioRecorder.resetRecording();
  }, [audioRecorder]);

  // Sync listening state with audio recorder
  useEffect(() => {
    if (mode === 'audio-recorder') {
      setIsListening(audioRecorder.isRecording);
      if (audioRecorder.error && !error) {
        setError(audioRecorder.error);
      }
    }
  }, [mode, audioRecorder.isRecording, audioRecorder.error, error]);

  return {
    isListening,
    transcript,
    interimTranscript,
    isSupported,
    error,
    mode,
    recordingTime: audioRecorder.recordingTime,
    startListening,
    stopListening,
    resetTranscript,
    requestMicrophonePermission,
  };
}
