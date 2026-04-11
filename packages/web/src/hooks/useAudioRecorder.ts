import { useState, useCallback, useRef, useEffect } from 'react';

export interface AudioRecorderState {
  isRecording: boolean;
  recordingTime: number;
  error: string | null;
  audioBlob: Blob | null;
}

export interface AudioRecorderActions {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
  requestPermission: () => Promise<boolean>;
}

export function useAudioRecorder(): AudioRecorderState & AudioRecorderActions {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      // Check if we're in a secure context
      if (!window.isSecureContext) {
        setError('Microphone access requires HTTPS or localhost');
        return false;
      }

      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Microphone access is not supported in this environment. Please use the desktop app in a browser or check app permissions.');
        return false;
      }

      // Request permission explicitly
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });

      // Permission granted - store stream for later use
      stream.getTracks().forEach(track => track.stop());
      setError(null);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
        setError('Microphone permission denied. On macOS, go to System Settings > Privacy & Security > Microphone and enable access for Kai.');
      } else if (errorMsg.includes('NotFoundError') || errorMsg.includes('DevicesNotFoundError')) {
        setError('No microphone found. Please connect a microphone.');
      } else {
        setError(`Microphone error: ${errorMsg}`);
      }
      
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      chunksRef.current = [];

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Optimize for speech recognition
        } 
      });

      streamRef.current = stream;

      // Create media recorder with optimal settings for speech
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      };

      mediaRecorder.onerror = () => {
        setError('Recording error occurred');
        setIsRecording(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      
      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
        setError('Microphone permission denied. On macOS: System Settings > Privacy & Security > Microphone > Enable Kai');
      } else {
        setError(`Failed to start recording: ${errorMsg}`);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    setIsRecording(false);
  }, []);

  const resetRecording = useCallback(() => {
    setAudioBlob(null);
    setRecordingTime(0);
    setError(null);
    chunksRef.current = [];
  }, []);

  return {
    isRecording,
    recordingTime,
    error,
    audioBlob,
    startRecording,
    stopRecording,
    resetRecording,
    requestPermission,
  };
}
